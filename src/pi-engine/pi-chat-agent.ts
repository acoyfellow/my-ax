import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness, type EntryRecord } from "@earendil-works/pi-durable";
import { Agent, type Connection, type WSMessage } from "agents-pi";
import type { AgentEvent, AgentEventStream } from "@earendil-works/pi-durable";
import { readUploadBytes } from "../uploads";
import { judgeTurn, turnLimitsFromEnv, nextProgressSample, STUCK_TURN_NOTE, TURN_WATCHDOG_INTERVAL_SECONDS, type ProgressSample } from "../turn-watchdog";
import type { Attachment } from "../types";
import { PiHarness } from "agents-pi/harness/pi";
import { createAI } from "agents-pi/models/pi-ai";
import type { AccessIdentity } from "../auth";
import type { Env } from "../types";
import { getUserWorkspace, invalidateUserWorkspace, snapshotWorkspace } from "../workspace";
import { WORKSPACE_HOME } from "../workspace-path";
import { workspaceSandboxId } from "../workspace-policy";
import { chatWorkspaceExtension, type ChatWorkspace } from "./workspace-tools";
import { machineToolsExtension, type MachineToolRunner } from "./machine-tools";
import { MACHINECTL_CODE_TOOL, MACHINECTL_TOOL } from "../routes/machinectl";
import type { ToolContext } from "../types";
import { installGatewayModels, PI_ENGINE_GATEWAY_DEFAULT_MODEL, PI_GATEWAY_PROVIDER_ID, resolvePiModelChoice } from "./gateway-models";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

export const PI_ENGINE_DEFAULT_MODEL = "@cf/zai-org/glm-5.3";

const PI_ENGINE_INSTRUCTIONS = [
  "You are My AX running on the Pi engine.",
  `Each chat has its own Linux workspace with home ${WORKSPACE_HOME}. Use exec, read_file, write_file and list_files.`,
  "Keep working until the task is done. There is no step limit.",
].join("\n");

type PiChatState = { ownerEmail?: string; chatId?: string };

export type PiChatSubmitResult = { operationId: string; accepted: boolean };
export type PiChatWaitResult = { status: string; text?: string; reason?: string };
export type PiChatLiveView = {
  busy: boolean;
  model: string;
  entries: unknown[];
  partial: unknown | null;
  tools: unknown[];
  queued: number;
  retry: { at: number; error: string } | null;
  entryTimes: Record<number, number>;
};

function hasGatewayModels(env: Env): boolean {
  return Boolean((env as unknown as { LLM_GATEWAY_URL?: string }).LLM_GATEWAY_URL?.trim());
}

export class PiChatAgent extends Agent<Env, PiChatState> {
  initialState: PiChatState = {};
  ai = createAI({ binding: this.env.AI });
  registry = createRegistry();

  harness = new PiHarness({
    harness: ({ storage, context }) => {
      const models = createModels();
      models.setProvider(this.ai.provider);
      installGatewayModels(models, this.env);
      this.registry.install(chatWorkspaceExtension(() => this.chatWorkspace(), PI_ENGINE_INSTRUCTIONS));
      this.registry.install(machineToolsExtension(() => this.machineRunner()));
      return Harness.open(storage, { models, registry: this.registry }, context);
    },
    defaults: hasGatewayModels(this.env)
      ? { model: { provider: PI_GATEWAY_PROVIDER_ID, id: PI_ENGINE_GATEWAY_DEFAULT_MODEL }, thinkingLevel: "medium" }
      : { model: this.ai(PI_ENGINE_DEFAULT_MODEL), thinkingLevel: "low" },
  });

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.lifecycle.use(this.harness);
  }

  async onStart(): Promise<void> {
    if ([...this.getConnections()].length) await this.ensureEventStream();
  }

  private eventStream: AgentEventStream | null = null;

  private async ensureEventStream(): Promise<void> {
    if (this.eventStream) return;
    const stream = await this.harness.session().events();
    this.eventStream = stream;
    stream.start(async (events: readonly AgentEvent[]) => {
      const entryTimes = this.recordEntryTimes(events);
      this.broadcast(JSON.stringify({ type: "pi_events", events, entryTimes }));
    });
    void stream.closed.finally(() => {
      if (this.eventStream === stream) this.eventStream = null;
    });
  }

  async onConnect(connection: Connection): Promise<void> {
    await this.ensureEventStream();
    connection.send(JSON.stringify({ type: "pi_snapshot", view: await this.live() }));
  }

  async onMessage(connection: Connection, message: WSMessage): Promise<void> {
    if (typeof message !== "string") return;
    await this.ensureEventStream();
    let frame: { type?: string; text?: string; operationId?: string; attachments?: Attachment[]; model?: string } = {};
    try { frame = JSON.parse(message); } catch { return; }
    if (frame.type === "pi_ping") {
      connection.send(JSON.stringify({ type: "pi_pong" }));
      return;
    }
    if (frame.type === "pi_abort") {
      await this.abortAll();
      return;
    }
    if (frame.type === "pi_submit") {
      try {
        if (frame.model) await this.applyModelChoice(frame.model);
        const receipt = await this.submitInput(frame.text ?? "", frame.attachments ?? [], frame.operationId);
        connection.send(JSON.stringify({ type: "pi_receipt", operationId: receipt.operationId, accepted: receipt.accepted }));
      } catch (error) {
        connection.send(JSON.stringify({ type: "pi_error", operationId: frame.operationId, message: error instanceof Error ? error.message : String(error) }));
      }
    }
  }

  private async applyModelChoice(modelId: string): Promise<void> {
    const choice = resolvePiModelChoice(modelId);
    if (!choice) return;
    const current = (await this.live()).model;
    if (current !== choice.id) await this.setModel(choice.provider, choice.id);
  }

  async submitInput(text: string, attachments: Attachment[], operationId?: string): Promise<PiChatSubmitResult> {
    const images = await Promise.all(attachments.map(async (attachment) => ({
      type: "image" as const,
      data: bytesToBase64(await readUploadBytes(this.env, this.identity(), attachment)),
      mimeType: attachment.mime || "image/png",
    })));
    const content = images.length ? [{ type: "text" as const, text: text || "Describe the attached image." }, ...images] : text;
    const receipt = await this.harness.submit(content, { whenBusy: "followUp", ...(operationId ? { operationId } : {}) });
    this.progressSample = undefined;
    await this.armTurnWatchdog();
    return { operationId: receipt.operationId, accepted: receipt.accepted };
  }

  bind(identity: { email: string }, chatId: string): void {
    this.setState({ ownerEmail: identity.email.toLowerCase(), chatId });
  }

  private identity(): AccessIdentity {
    const ownerEmail = this.state.ownerEmail;
    if (!ownerEmail) throw new Error("pi chat is not bound to an owner");
    return { email: ownerEmail } as AccessIdentity;
  }

  private chatId(): string {
    const chatId = this.state.chatId;
    if (!chatId) throw new Error("pi chat is not bound to a chat id");
    return chatId;
  }

  private machineRunner(): MachineToolRunner {
    // machinectl tools only read env and identity from their context (same as
    // the /api/machinectl/code route), and scope everything to the owner.
    const context = { env: this.env, identity: this.identity() } as unknown as ToolContext;
    return {
      call: (args) => MACHINECTL_TOOL.execute(args, context),
      code: (args) => MACHINECTL_CODE_TOOL.execute(args, context),
    };
  }

  private async chatWorkspace(): Promise<ChatWorkspace> {
    const { sandbox } = await getUserWorkspace(this.env, this.identity(), { scope: { kind: "chat", chatId: this.chatId() } });
    return {
      exec: async (command, timeoutMs) => {
        const result = await sandbox.exec(command, { cwd: WORKSPACE_HOME, timeout: timeoutMs, env: this.toolEnv() });
        return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.exitCode ?? -1 };
      },
      readFile: async (path) => {
        const file = await sandbox.readFile(path);
        return (file as unknown as { content?: string }).content ?? "";
      },
      writeFile: async (path, content) => {
        const parent = path.slice(0, path.lastIndexOf("/")) || WORKSPACE_HOME;
        await sandbox.exec(`mkdir -p ${JSON.stringify(parent)}`, { cwd: "/", timeout: 30_000 });
        await sandbox.writeFile(path, content);
      },
      listFiles: async (path) => {
        const result = await sandbox.listFiles(path);
        return result.files.map((file) => `${file.type === "directory" ? "d" : "-"} ${file.absolutePath}`);
      },
    };
  }

  private toolEnv(): Record<string, string> {
    const token = this.env.GITHUB_TOKEN?.trim();
    return token ? { GH_TOKEN: token, GITHUB_TOKEN: token } : {};
  }

  async setModel(provider: string, id: string): Promise<void> {
    await this.harness.session().setModel({ provider, id });
  }

  async submit(text: string, operationId?: string): Promise<PiChatSubmitResult> {
    const receipt = await this.harness.submit(text, { whenBusy: "followUp", ...(operationId ? { operationId } : {}) });
    return { operationId: receipt.operationId, accepted: receipt.accepted };
  }

  async wait(operationId: string): Promise<PiChatWaitResult> {
    const result = await this.harness.wait(operationId);
    return { status: result.status, text: result.text, reason: result.reason };
  }

  async transcriptJson(): Promise<string> {
    const entries: EntryRecord[] = await this.harness.messages();
    return JSON.stringify(entries);
  }

  private recordEntryTimes(events: readonly AgentEvent[]): Record<number, number> {
    const now = Date.now();
    const recorded: Record<number, number> = {};
    for (const event of events as ReadonlyArray<{ entry?: { id?: unknown } }>) {
      const id = event.entry?.id;
      if (typeof id !== "number") continue;
      const existing = this.ctx.storage.kv.get<number>(`entry-time:${id}`);
      if (existing !== undefined) { recorded[id] = existing; continue; }
      this.ctx.storage.kv.put(`entry-time:${id}`, now);
      recorded[id] = now;
    }
    return recorded;
  }

  private entryTimes(): Record<number, number> {
    const times: Record<number, number> = {};
    for (const [key, value] of this.ctx.storage.kv.list<number>({ prefix: "entry-time:" })) times[Number(key.slice("entry-time:".length))] = value;
    return times;
  }

  async live(): Promise<PiChatLiveView> {
    const stream = await this.harness.session().events();
    const snapshot = stream.snapshot;
    await stream.stop();
    const model = (snapshot.agent as { model?: { modelId?: string; id?: string } }).model;
    return {
      busy: snapshot.run !== undefined,
      model: model?.modelId ?? model?.id ?? "",
      entries: [...snapshot.entries],
      partial: snapshot.generation?.message ?? null,
      tools: [...snapshot.tools],
      queued: snapshot.inbox.length,
      retry: snapshot.generation?.retry ?? null,
      entryTimes: this.entryTimes(),
    };
  }

  async busy(): Promise<boolean> {
    return (await this.harness.pending()).length > 0;
  }

  async abortAll(): Promise<void> {
    await this.harness.abort();
    this.progressSample = undefined;
    this.broadcast(JSON.stringify({ type: "pi_aborted" }));
  }

  private progressSample: ProgressSample | undefined;

  private async armTurnWatchdog(): Promise<void> {
    if (this.getSchedules().some((schedule) => schedule.callback === "checkTurnProgress")) return;
    await this.scheduleEvery(TURN_WATCHDOG_INTERVAL_SECONDS, "checkTurnProgress").catch((error) => console.error("pi_turn_watchdog_arm_failed", { err: String(error) }));
  }

  private async disarmTurnWatchdog(): Promise<void> {
    for (const schedule of this.getSchedules().filter((candidate) => candidate.callback === "checkTurnProgress")) {
      await this.cancelSchedule(schedule.id);
    }
  }

  async checkTurnProgress(): Promise<void> {
    const view = await this.live();
    const now = Date.now();
    const signature = JSON.stringify([view.entries.length, view.partial, view.tools, view.queued, view.retry]);
    this.progressSample = nextProgressSample(this.progressSample, signature, now);
    const verdict = judgeTurn({ active: view.busy, lastProgressAt: this.progressSample.at, toolsRunning: view.tools.length }, now, turnLimitsFromEnv((this.env as { TURN_WATCHDOG_LIMIT_SECONDS?: string }).TURN_WATCHDOG_LIMIT_SECONDS));
    if (verdict === "healthy") return;
    await this.disarmTurnWatchdog();
    this.progressSample = undefined;
    if (verdict === "idle") return;
    console.error("pi_turn_stuck_ended", { chatId: this.state.chatId, tools: view.tools.length });
    await this.harness.abort();
    this.broadcast(JSON.stringify({ type: "pi_error", message: STUCK_TURN_NOTE }));
  }

  async crash(): Promise<void> {
    console.warn("pi_chat_crash_requested", { chatId: this.state.chatId });
    this.ctx.abort("owner requested a crash test");
  }

  async recycleWorkspace(): Promise<{ snapshot: string; destroyed: boolean }> {
    const identity = this.identity();
    const scope = { kind: "chat" as const, chatId: this.chatId() };
    const outcome = await snapshotWorkspace(this.env, identity, "recycle", { scope });
    if (!outcome.published) throw new Error(`snapshot not published: ${outcome.reason}`);
    const { sandbox } = await getUserWorkspace(this.env, identity, { scope });
    await sandbox.destroy();
    invalidateUserWorkspace(identity, scope);
    return { snapshot: outcome.backup.id, destroyed: true };
  }

  async sandboxId(): Promise<string> {
    return workspaceSandboxId(this.identity().email, { kind: "chat", chatId: this.chatId() });
  }
}
