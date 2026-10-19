import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness, type EntryRecord } from "@earendil-works/pi-durable";
import { Agent, type Connection, type WSMessage } from "agents-pi";
import type { AgentEvent, AgentEventStream } from "@earendil-works/pi-durable";
import { readUploadBytes } from "../uploads";
import { judgeTurn, turnLimitsFromEnv, nextProgressSample, STUCK_TURN_NOTE, TURN_WATCHDOG_INTERVAL_SECONDS, type ProgressSample } from "../turn-watchdog";
import type { Attachment } from "../types";
import { PiHarness } from "agents-pi/harness/pi";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { forkEntriesUpTo, type ForkEntry } from "./fork";
import { indexRowsFor, type ConversationMemory } from "./conversation-index";
import { chatMemoryExtension, memoryToolsExtension } from "./memory-tools";
import { sharedToolsExtension } from "./legacy-tools";
import { ownerInstructionsExtension } from "./owner-instructions-tools";
import { connectorToolsExtension, type ConnectorRunner } from "./connector-tools";
import { createToolContext } from "../tool-context";
import { PUBLIC_SYSTEM } from "../system-prompt";
import { widgetWording } from "../widget-names";
import { selectLivePageConnection, type PageConnectionState } from "../page-connection";
import { createMyAxBrowserTools } from "../browser-tools";
import { DEFAULT_OWNER_INSTRUCTIONS, getOwnerInstructions } from "../owner-instructions";
import { Effect } from "effect";
import type { ToolSet } from "ai";
import { z } from "zod";
import { DELEGATE_MANY_DESCRIPTION, delegateManyInputSchema } from "../delegate-many";
import { buildConversationSearchQuery } from "../conversation-search";
import { createAI } from "agents-pi/models/pi-ai";
import type { AccessIdentity } from "../auth";
import type { Env } from "../types";
import { getUserWorkspace, invalidateUserWorkspace, saveWorkspaceDisk, snapshotWorkspace } from "../workspace";
import { WORKSPACE_HOME } from "../workspace-path";
import { TURN_SNAPSHOT_COOLDOWN_MS, workspaceSandboxId } from "../workspace-policy";
import { lastTurnFailed } from "./last-turn-failed";
import { slimEntries, slimEntry, slimEvent, type SlimmableEntry } from "./slim-entries";
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
  `Each chat has its own Linux workspace with home ${WORKSPACE_HOME}. Use exec, read_file, write_file and list_files. Use search_conversations and read_conversation for earlier chats.`,
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

export type PiChatSlimView = PiChatLiveView & { olderCount: number };

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
      this.registry.install(memoryToolsExtension(() => this.conversationMemory()));
      this.registry.install(sharedToolsExtension({ context: () => this.sharedToolContext(), extra: () => this.sharedExtraTools(), instructions: widgetWording(PUBLIC_SYSTEM) }));
      this.registry.install(ownerInstructionsExtension(() => this.ownerInstructions()));
      this.registry.install(connectorToolsExtension(() => this.connectorRunner()));
      this.registry.install(chatMemoryExtension(() => ({ read: () => this.ctx.storage.kv.get<string>("chat-memory") ?? "", write: (text) => this.ctx.storage.kv.put("chat-memory", text) })));
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

  private publishedRunning: boolean | null = null;

  private async publishRunStatus(running: boolean, entries?: readonly unknown[]): Promise<void> {
    const finished = this.publishedRunning === true && !running;
    if (this.publishedRunning === running) return;
    this.publishedRunning = running;
    if (finished) await this.schedule(0, "snapshotWorkspaceAfterTurn", undefined, { idempotent: true }).catch((error: unknown) => console.error("pi_turn_snapshot_schedule_failed", { err: String(error) }));
    const ownerEmail = this.state?.ownerEmail;
    const chatId = this.state?.chatId;
    if (!ownerEmail || !chatId) return;
    const status = running ? "running" : lastTurnFailed(entries ?? await this.currentEntries()) ? "error" : "active";
    console.info("pi_run_status_published", { chatId, status });
    await this.env.DB.prepare("UPDATE sessions SET status = ?, updated_at = CASE WHEN ? = 'running' THEN datetime('now') ELSE updated_at END WHERE id = ? AND owner_email = ? AND status IN ('active', 'running', 'error') AND status != ?")
      .bind(status, status, chatId, ownerEmail.toLowerCase(), status).run()
      .catch((error: unknown) => console.error("pi_run_status_publish_failed", { err: String(error) }));
  }

  private publishing: Promise<void> = Promise.resolve();

  private publishCurrentRunStatus(entries?: readonly unknown[]): Promise<void> {
    this.publishing = this.publishing.then(async () => {
      const running = await this.harness.session().busy();
      await this.publishRunStatus(running, entries);
    }).catch((error: unknown) => console.error("pi_run_status_publish_failed", { err: String(error) }));
    return this.publishing;
  }

  private async ensureEventStream(): Promise<void> {
    if (this.eventStream) return;
    const stream = await this.harness.session().events();
    this.eventStream = stream;
    stream.start(async (events: readonly AgentEvent[]) => {
      this.cachedSlimView = null;
      this.ctx.waitUntil(this.publishCurrentRunStatus());
      const entryTimes = this.recordEntryTimes(events);
      this.broadcast(JSON.stringify({ type: "pi_events", events: events.map(slimEvent), entryTimes }));
      if (events.some((event) => (event as { entry?: unknown }).entry)) this.ctx.waitUntil(this.indexConversation().catch((error) => console.error("pi_conversation_index_failed", { err: String(error) })));
    });
    void stream.closed.finally(() => {
      this.cachedSlimView = null;
      if (this.eventStream === stream) this.eventStream = null;
    });
  }

  async onConnect(connection: Connection): Promise<void> {
    const started = Date.now();
    const cached = this.cachedSlimView !== null;
    await this.ensureEventStream();
    const streamed = Date.now();
    const view = await this.slimLive();
    connection.send(JSON.stringify({ type: "pi_snapshot", view }));
    console.info("pi_connect_timing", { cached, streamMs: streamed - started, viewMs: Date.now() - streamed });
  }

  async onMessage(connection: Connection, message: WSMessage): Promise<void> {
    if (typeof message !== "string") return;
    await this.ensureEventStream();
    let frame: { type?: string; text?: string; operationId?: string; attachments?: Attachment[]; model?: string; [key: string]: unknown } = {};
    try { frame = JSON.parse(message); } catch { return; }
    if (frame.type === "page_result") {
      const result = frame as { requestId?: string; ok?: boolean; result?: unknown; error?: string };
      const pending = result.requestId ? this.pendingPageCalls.get(result.requestId) : undefined;
      if (pending && result.requestId) {
        this.pendingPageCalls.delete(result.requestId);
        clearTimeout(pending.timer);
        if (result.ok) pending.resolve(result.result ?? null);
        else pending.reject(new Error(result.error || "page verb failed"));
      }
      return;
    }
    if (frame.type === "my_ax_visibility") {
      const visibility = frame as { visible?: boolean; standalone?: boolean; platform?: string; uaMobile?: boolean };
      connection.setState({ ...((connection.state ?? {}) as Record<string, unknown>), chatVisible: visibility.visible === true, standalone: visibility.standalone === true, platform: typeof visibility.platform === "string" ? visibility.platform.slice(0, 80) : null, uaMobile: visibility.uaMobile === true });
      return;
    }
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
    await this.ensureEventStream();
    const receipt = await this.harness.submit(content, { whenBusy: "followUp", ...(operationId ? { operationId } : {}) });
    this.progressSample = undefined;
    await this.publishCurrentRunStatus();
    await this.armTurnWatchdog();
    return { operationId: receipt.operationId, accepted: receipt.accepted };
  }

  bind(identity: { email: string }, chatId: string): void {
    const ownerEmail = identity.email.toLowerCase();
    if (this.state?.ownerEmail === ownerEmail && this.state?.chatId === chatId) return;
    this.setState({ ownerEmail, chatId });
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

  private pendingPageCalls = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  private callPage(verb: string, args?: Record<string, unknown>, opts?: { timeoutMs?: number }): Promise<unknown> {
    const target = selectLivePageConnection([...this.getConnections<PageConnectionState>()]);
    if (!target) return Promise.reject(new Error("page_unavailable: no live Chat tab connected to this session"));
    const requestId = `page-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const timeoutMs = Math.min(Math.max(opts?.timeoutMs ?? 10_000, 1000), 30_000);
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingPageCalls.delete(requestId);
        reject(new Error(`page_timeout: verb ${verb} did not reply within ${timeoutMs}ms`));
      }, timeoutMs);
      this.pendingPageCalls.set(requestId, { resolve, reject, timer });
      try {
        target.send(JSON.stringify({ type: "page_call", requestId, verb, args: args ?? {} }));
      } catch (error) {
        this.pendingPageCalls.delete(requestId);
        clearTimeout(timer);
        reject(new Error(`page_send_failed: ${String(error)}`));
      }
    });
  }

  private sharedToolContext(): ToolContext {
    const identity = this.identity();
    const chatId = this.chatId();
    return createToolContext({
      env: this.env,
      identity,
      sessionId: chatId,
      scope: { kind: "chat", chatId },
      sandboxOnly: false,
      broadcast: (message) => this.broadcast(message),
      callPage: (verb, args, opts) => this.callPage(verb, args, opts),
      runSavedRecipe: async (body) => (await this.helperAgent()).runSavedRecipe(body),
    });
  }

  private async helperAgent() {
    const identity = this.identity();
    const { getSessionAgent } = await import("../agent-stub");
    const helper = await getSessionAgent(this.env, identity.email, `recipes-${this.chatId()}`);
    await helper.seedIdentity(identity);
    return helper;
  }

  private connectorRunner(): ConnectorRunner {
    return {
      list: async () => (await this.helperAgent()).connectorCatalog(),
      call: async (serverId, toolName, args) => (await this.helperAgent()).connectorCall(serverId, toolName, args),
    };
  }

  private sharedExtraTools(): ToolSet {
    return {
      ...createMyAxBrowserTools(this.env, () => this.identity(), () => this.chatId()),
      delegate_many: {
        description: DELEGATE_MANY_DESCRIPTION,
        inputSchema: { jsonSchema: z.toJSONSchema(delegateManyInputSchema) },
        execute: async (input: unknown, options: { toolCallId: string }) => (await this.helperAgent()).runDelegateMany(input, options.toolCallId),
      } as unknown as ToolSet[string],
    };
  }

  private async ownerInstructions(): Promise<string> {
    return Effect.runPromise(getOwnerInstructions(this.env, this.identity().email)).catch(() => DEFAULT_OWNER_INSTRUCTIONS);
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
    return this.submitInput(text, [], operationId);
  }

  async wait(operationId: string): Promise<PiChatWaitResult> {
    const result = await this.harness.wait(operationId);
    await this.indexConversation().catch((error) => console.error("pi_conversation_index_failed", { err: String(error) }));
    return { status: result.status, text: result.text, reason: result.reason };
  }

  async forkEntriesAt(entryId: number): Promise<ForkEntry[]> {
    const entries: EntryRecord[] = await this.harness.messages();
    return forkEntriesUpTo(entries, entryId);
  }

  async seedFromFork(entries: readonly ForkEntry[]): Promise<number> {
    if ((await this.harness.messages()).length > 0) throw new Error("fork target already has messages");
    const conversation = await this.harness.conversation("1");
    await conversation.commit(async (tx) => {
      for (const entry of entries) await tx.appendEntry(conversation.id, entry as never);
    }, BACKGROUND_CONTEXT);
    return entries.length;
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

  private async currentEntries(): Promise<readonly unknown[]> {
    const stream = await this.harness.session().events();
    const entries = [...stream.snapshot.entries];
    await stream.stop();
    return entries;
  }

  async isBusy(): Promise<boolean> {
    return this.harness.session().busy();
  }

  async slimLiveFor(identity: { email: string }, chatId: string): Promise<PiChatSlimView> {
    this.bind(identity, chatId);
    return this.slimLive();
  }

  private cachedSlimView: PiChatSlimView | null = null;

  async slimLive(): Promise<PiChatSlimView> {
    await this.ensureEventStream();
    if (this.cachedSlimView && this.eventStream) {
      this.ctx.waitUntil(this.publishCurrentRunStatus());
      return { ...this.cachedSlimView, entryTimes: this.entryTimes() };
    }
    const view = await this.live();
    const slim = slimEntries(view.entries as SlimmableEntry[]);
    const slimView = { ...view, entries: slim.entries, olderCount: slim.olderCount, partial: view.partial ? slimEvent({ message: view.partial }).message ?? null : null };
    if (this.eventStream) this.cachedSlimView = slimView;
    return slimView;
  }

  async entriesPage(before: number, limit: number): Promise<{ entries: unknown[]; olderCount: number }> {
    const entries = (await this.live()).entries as SlimmableEntry[];
    const end = entries.findIndex((entry) => entry.id >= before);
    const stop = end < 0 ? entries.length : end;
    const start = Math.max(0, stop - Math.min(Math.max(limit, 1), 200));
    return { entries: entries.slice(start, stop).map(slimEntry), olderCount: start };
  }

  async fullEntry(id: number): Promise<unknown | null> {
    return ((await this.live()).entries as SlimmableEntry[]).find((entry) => entry.id === id) ?? null;
  }

  async live(): Promise<PiChatLiveView> {
    const stream = await this.harness.session().events();
    const snapshot = stream.snapshot;
    await stream.stop();
    this.ctx.waitUntil(this.publishCurrentRunStatus(snapshot.entries));
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
    await this.indexConversation().catch((error) => console.error("pi_conversation_index_failed", { err: String(error) }));
    if (verdict === "healthy") return;
    await this.disarmTurnWatchdog();
    this.progressSample = undefined;
    if (verdict === "idle") {
      this.publishedRunning = true;
      await this.publishRunStatus(false, view.entries);
      return;
    }
    console.error("pi_turn_stuck_ended", { chatId: this.state.chatId, tools: view.tools.length });
    await this.harness.abort();
    this.broadcast(JSON.stringify({ type: "pi_error", message: STUCK_TURN_NOTE }));
  }

  private indexing: Promise<void> = Promise.resolve();

  indexConversation(): Promise<void> {
    this.indexing = this.indexing.then(() => this.indexNewEntries());
    return this.indexing;
  }

  private async indexNewEntries(): Promise<void> {
    const ownerEmail = this.state.ownerEmail;
    const chatId = this.state.chatId;
    if (!ownerEmail || !chatId) return;
    const after = this.ctx.storage.kv.get<number>("indexed-through") ?? 0;
    const entries = (await this.harness.messages()) as unknown as Array<{ id: number; kind: string; model?: unknown[] }>;
    const rows = indexRowsFor(entries, after);
    const times = this.entryTimes();
    for (const row of rows) {
      const ts = new Date(times[row.piEntryId] ?? Date.now()).toISOString();
      const uiMessageId = `pi:${row.piEntryId}:${row.role}`;
      await this.env.DB.prepare(
        `INSERT INTO conversation_entries(session_id, owner_email, ts, role, tool, is_error, content, meta_json, sequence_number)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT MAX(sequence_number) + 1 FROM conversation_entries WHERE session_id = ? AND owner_email = ?), 1)
         WHERE NOT EXISTS (SELECT 1 FROM conversation_entries WHERE session_id = ? AND owner_email = ? AND role = ? AND ui_message_id = ?)`,
      ).bind(chatId, ownerEmail, ts, row.role, row.tool, row.isError ? 1 : 0, row.content, JSON.stringify({ uiMessageId, engine: "pi" }), chatId, ownerEmail, chatId, ownerEmail, row.role, uiMessageId).run();
    }
    const last = entries.reduce((max, entry) => Math.max(max, entry.id), after);
    if (last > after) this.ctx.storage.kv.put("indexed-through", last);
  }

  private conversationMemory(): ConversationMemory {
    const email = this.identity().email;
    return {
      search: async (query, options) => {
        const built = buildConversationSearchQuery(query, email, options);
        if (!built) return [];
        return (await this.env.DB.prepare(built.sql).bind(...built.params).all<{ sessionId: string; ts: string; role: string; snippet: string }>()).results ?? [];
      },
      read: async (sessionId, limit) => {
        const rows = await this.env.DB.prepare(
          "SELECT ts, role, tool, substr(content, 1, 4000) AS content FROM (SELECT id, ts, role, tool, content FROM conversation_entries WHERE session_id = ? AND owner_email = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC",
        ).bind(sessionId, email, limit).all<{ ts: string; role: string; tool: string | null; content: string }>();
        return rows.results ?? [];
      },
    };
  }

  async crash(): Promise<void> {
    console.warn("pi_chat_crash_requested", { chatId: this.state.chatId });
    this.ctx.abort("owner requested a crash test");
  }

  async recycleWorkspace(): Promise<{ snapshot: string; destroyed: boolean }> {
    const identity = this.identity();
    const scope = { kind: "chat" as const, chatId: this.chatId() };
    const disk = await saveWorkspaceDisk(this.env, identity, scope, "recycle").catch((error: unknown) => {
      console.error("pi_disk_snapshot_on_recycle_failed", { chatId: scope.chatId, err: String(error) });
      return null;
    });
    const outcome = await snapshotWorkspace(this.env, identity, "recycle", { scope }).catch((error: unknown) => {
      if (!disk) throw error;
      console.error("pi_directory_backup_on_recycle_failed", { chatId: scope.chatId, err: String(error) });
      return null;
    });
    if (!disk && outcome && !outcome.published) throw new Error(`snapshot not published: ${outcome.reason}`);
    const { sandbox } = await getUserWorkspace(this.env, identity, { scope });
    await sandbox.destroy();
    invalidateUserWorkspace(identity, scope);
    return { snapshot: disk?.id ?? (outcome?.published ? outcome.backup.id : ""), destroyed: true };
  }

  async snapshotWorkspaceAfterTurn(): Promise<void> {
    const identity = this.identity();
    const scope = { kind: "chat" as const, chatId: this.chatId() };
    await saveWorkspaceDisk(this.env, identity, scope, "turn").catch((error: unknown) => console.error("pi_disk_snapshot_after_turn_failed", { chatId: scope.chatId, err: String(error) }));
    const outcome = await snapshotWorkspace(this.env, identity, "turn", { scope, respectCooldown: true }).catch((error: unknown) => {
      console.error("pi_workspace_snapshot_after_turn_failed", { chatId: scope.chatId, err: String(error) });
      return null;
    });
    if (outcome && !outcome.published && outcome.reason === "cooldown") {
      await this.schedule(Math.ceil(TURN_SNAPSHOT_COOLDOWN_MS / 1000), "snapshotWorkspaceAfterTurn", undefined, { idempotent: true });
    }
  }

  async sandboxId(): Promise<string> {
    return workspaceSandboxId(this.identity().email, { kind: "chat", chatId: this.chatId() });
  }
}
