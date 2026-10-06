import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness, type EntryRecord } from "@earendil-works/pi-durable";
import { Agent } from "agents-pi";
import { PiHarness } from "agents-pi/harness/pi";
import { createAI } from "agents-pi/models/pi-ai";
import type { AccessIdentity } from "../auth";
import type { Env } from "../types";
import { getUserWorkspace, invalidateUserWorkspace, snapshotWorkspace } from "../workspace";
import { WORKSPACE_HOME } from "../workspace-path";
import { workspaceSandboxId } from "../workspace-policy";
import { chatWorkspaceExtension, type ChatWorkspace } from "./workspace-tools";
import { installGatewayModels, PI_ENGINE_GATEWAY_DEFAULT_MODEL, PI_GATEWAY_PROVIDER_ID } from "./gateway-models";

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
    };
  }

  async busy(): Promise<boolean> {
    return (await this.harness.pending()).length > 0;
  }

  async abortAll(): Promise<void> {
    await this.harness.abort();
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
