import { getSandbox, type DirectoryBackup, type ExecOptions, type ProcessOptions, type RunCodeOptions, type Sandbox } from "@cloudflare/sandbox";
import { DiskSandbox } from "./disk-sandbox";
import { bootWorkspace, measureHomeBytes, type WorkspaceBinding } from "./workspace-boot";
import { createWorkspaceLifecycle, LOST_MID_COMMAND_NOTE, WorkspaceLost, type OperationKind, type WorkspaceLifecycle } from "./workspace-lifecycle";
import { execTreatingShellExitAsResult } from "./workspace-exec";
import { recordObserveEvent } from "./observe-events";
import type { BackgroundProcessInfo } from "./types";
import { workspaceSandboxId, type WorkspaceScope } from "./workspace-policy";

const BINDING_KEY = "workspace-binding";
const LOSS_LOG_KEY = "workspace-losses";
const EXPECTED_RUNNING_KEY = "workspace-expected-running";
const HEALTH_PROBE_TIMEOUT_MS = 5_000;

export type WorkspaceExecResult = { stdout: string; stderr: string; exitCode: number; workspaceLost?: true };
export type WorkspaceLoss = { at: number; reason: string };
export type WorkspaceFile = { name: string; absolutePath: string; type: "file" | "directory" | "symlink" | "other"; size: number; modifiedAt: string };
export type WorkspaceProcess = BackgroundProcessInfo;

type WorkspaceEnv = { DB: D1Database };

function processRecord(process: { id: string; pid?: number; command: string; status: string; startTime: Date; endTime?: Date; exitCode?: number | null; sessionId?: string }): WorkspaceProcess {
  return { id: process.id, pid: process.pid, command: process.command, status: process.status as WorkspaceProcess["status"], startTime: process.startTime.toISOString(), endTime: process.endTime?.toISOString(), exitCode: process.exitCode ?? undefined, sessionId: process.sessionId };
}

export class WorkspaceObject extends DiskSandbox {
  private lifecycle: WorkspaceLifecycle | undefined;
  private bootOptions = { restoreLatest: true };

  private binding(): WorkspaceBinding | null {
    return this.ctx.storage.kv.get<WorkspaceBinding>(BINDING_KEY) ?? null;
  }

  private db(): D1Database {
    return (this.env as unknown as WorkspaceEnv).DB;
  }

  private lifecycleFor(): WorkspaceLifecycle {
    this.lifecycle ??= createWorkspaceLifecycle({
      running: () => this.ctx.container?.running ?? false,
      healthy: async () => {
        const probe = await this.exec("true", { cwd: "/", timeout: HEALTH_PROBE_TIMEOUT_MS, origin: "internal" } as ExecOptions);
        return probe.exitCode === 0;
      },
      boot: async () => {
        const binding = this.binding();
        if (!binding) throw new Error("workspace binding is not set");
        await bootWorkspace(this.db(), binding, {
          exec: (command, options) => this.exec(command, options as ExecOptions),
          restoreBackup: (backup) => this.restoreBackup(backup),
          destroy: () => this.destroy(),
          restoredFromDiskSnapshot: async () => {
            const state = await this.diskState();
            return state.managed ? state.restoredFrom : null;
          },
        }, this.bootOptions);
      },
      destroy: () => this.destroy(),
      expectedRunning: () => this.ctx.storage.kv.get<boolean>(EXPECTED_RUNNING_KEY) ?? false,
      setExpectedRunning: (expected) => this.ctx.storage.kv.put(EXPECTED_RUNNING_KEY, expected),
      announceLoss: (reason) => this.recordLoss(reason),
    });
    return this.lifecycle;
  }

  private async recordLoss(reason: string): Promise<void> {
    const losses = this.ctx.storage.kv.get<WorkspaceLoss[]>(LOSS_LOG_KEY) ?? [];
    this.ctx.storage.kv.put(LOSS_LOG_KEY, [...losses, { at: Date.now(), reason }].slice(-20));
    const binding = this.binding();
    if (!binding) return;
    console.warn("workspace_lost", { scope: binding.scope.kind, reason });
    await recordObserveEvent(this.db(), { ownerEmail: binding.ownerEmail, sessionId: binding.scope.kind === "chat" ? binding.scope.chatId : null, kind: "workspace", name: "lost", outcome: "error", message: reason }).catch(() => undefined);
  }

  private run<T>(kind: OperationKind, operation: () => Promise<T>): Promise<T> {
    return this.lifecycleFor().use(kind, operation);
  }

  async bind(binding: WorkspaceBinding): Promise<void> {
    const current = this.binding();
    if (current && current.ownerEmail === binding.ownerEmail && JSON.stringify(current.scope) === JSON.stringify(binding.scope)) return;
    this.ctx.storage.kv.put(BINDING_KEY, binding);
  }

  async takeLosses(): Promise<WorkspaceLoss[]> {
    const losses = this.ctx.storage.kv.get<WorkspaceLoss[]>(LOSS_LOG_KEY) ?? [];
    this.ctx.storage.kv.delete(LOSS_LOG_KEY);
    return losses;
  }

  async awake(options?: { restoreLatest?: boolean }): Promise<void> {
    this.bootOptions = { restoreLatest: options?.restoreLatest ?? true };
    await this.run("idempotent", async () => undefined);
  }

  async isRunning(): Promise<boolean> {
    return this.ctx.container?.running ?? false;
  }

  private lossNotice(): string {
    const losses = this.ctx.storage.kv.get<WorkspaceLoss[]>(LOSS_LOG_KEY) ?? [];
    if (!losses.length) return "";
    this.ctx.storage.kv.delete(LOSS_LOG_KEY);
    const last = losses[losses.length - 1];
    return `[workspace notice: ${last.reason} at ${new Date(last.at).toISOString()}; it was restarted from the last saved disk, and changes made after that save are gone]\n`;
  }

  async shell(command: string, options: ExecOptions): Promise<WorkspaceExecResult> {
    try {
      const result = await this.run("side-effecting", () => execTreatingShellExitAsResult(() => this.exec(command, options)));
      return { stdout: result.stdout ?? "", stderr: `${this.lossNotice()}${result.stderr ?? ""}`, exitCode: result.exitCode ?? -1 };
    } catch (error) {
      if (error instanceof WorkspaceLost) return { stdout: "", stderr: `${this.lossNotice()}[${LOST_MID_COMMAND_NOTE}]\n`, exitCode: -1, workspaceLost: true };
      throw error;
    }
  }

  async read(path: string): Promise<string> {
    const file = await this.run("idempotent", () => this.readFile(path));
    return (file as { content?: string }).content ?? "";
  }

  async readBytes(path: string): Promise<Uint8Array> {
    return this.run("idempotent", async () => {
      const file = await this.readFile(path, { encoding: "base64" });
      const content = (file as { content?: string }).content ?? "";
      return Uint8Array.from(atob(content), (char) => char.charCodeAt(0));
    });
  }

  async write(path: string, content: string | Uint8Array): Promise<void> {
    const parent = path.slice(0, path.lastIndexOf("/")) || "/";
    await this.run("idempotent", async () => {
      await this.mkdir(parent, { recursive: true });
      if (typeof content === "string") await this.writeFile(path, content);
      else await this.writeFile(path, btoa(String.fromCharCode(...content)), { encoding: "base64" });
    });
  }

  async makeDirectory(path: string): Promise<void> {
    await this.run("idempotent", () => this.mkdir(path, { recursive: true }));
  }

  async list(path: string, options?: { recursive?: boolean; includeHidden?: boolean }): Promise<WorkspaceFile[]> {
    const result = await this.run("idempotent", () => this.listFiles(path, options));
    return result.files.map((file) => ({ name: file.name, absolutePath: file.absolutePath, type: file.type, size: file.size, modifiedAt: file.modifiedAt }));
  }

  async remove(path: string): Promise<void> {
    await this.run("idempotent", () => this.deleteFile(path));
  }

  async spawn(command: string, options: ProcessOptions): Promise<WorkspaceProcess> {
    return processRecord(await this.run("side-effecting", () => this.startProcess(command, options)) as never);
  }

  async processInfo(id: string): Promise<WorkspaceProcess | null> {
    return this.run("idempotent", async () => {
      const process = await this.getProcess(id);
      if (!process) return null;
      await process.getStatus();
      const current = (await this.getProcess(id)) ?? process;
      return processRecord(current as never);
    });
  }

  async processOutput(id: string): Promise<{ processId: string; stdout: string; stderr: string } | null> {
    return this.run("idempotent", async () => {
      if (!(await this.getProcess(id))) return null;
      const logs = await this.getProcessLogs(id);
      return { processId: logs.processId, stdout: logs.stdout ?? "", stderr: logs.stderr ?? "" };
    });
  }

  async stopProcess(id: string, signal: string): Promise<boolean> {
    return this.run("idempotent", async () => {
      if (!(await this.getProcess(id))) return false;
      await this.killProcess(id, signal);
      return true;
    });
  }

  async code(source: string, options: { language: "python" | "javascript" | "typescript"; cwd: string; run: RunCodeOptions }): Promise<unknown> {
    return this.run("side-effecting", async () => {
      const context = await this.createCodeContext({ language: options.language, cwd: options.cwd });
      return JSON.parse(JSON.stringify(await this.runCode(source, { ...options.run, context })));
    });
  }

  async tunnel(method: "get" | "list" | "destroy", args: unknown[]): Promise<unknown> {
    return this.run("idempotent", () => this.callTunnels(method, args));
  }

  async homeBytes(): Promise<number | null> {
    return this.run("idempotent", () => measureHomeBytes({ exec: (command, options) => this.exec(command, options as ExecOptions) }));
  }

  async backup(options: Parameters<Sandbox["createBackup"]>[0]): Promise<DirectoryBackup> {
    return this.run("idempotent", () => this.createBackup(options));
  }

  async restore(backup: DirectoryBackup): Promise<unknown> {
    return this.run("idempotent", () => this.restoreBackup(backup));
  }

  async stopContainer(): Promise<void> {
    this.lifecycleFor().stopped();
    await this.destroy();
  }

  override async onActivityExpired(): Promise<void> {
    this.lifecycleFor().stopped();
    await super.onActivityExpired();
  }
}

export type WorkspaceStub = DurableObjectStub<WorkspaceObject> & { terminal: (request: Request, options?: { cols?: number; rows?: number }) => Promise<Response> };

export type WorkspaceIdentity = { email: string };

export function workspaceNamespace(env: unknown): DurableObjectNamespace<WorkspaceObject> {
  return (env as { SANDBOX: DurableObjectNamespace<WorkspaceObject> }).SANDBOX;
}

const SANDBOX_STUB_OPTIONS = {
  containerTimeouts: { instanceGetTimeoutMS: 120_000, portReadyTimeoutMS: 240_000 },
  transport: "rpc" as const,
};

export function sandboxStub(namespace: DurableObjectNamespace<Sandbox>, id: string) {
  return getSandbox(namespace, id, SANDBOX_STUB_OPTIONS);
}

export async function workspaceFor(env: unknown, identity: WorkspaceIdentity, scope: WorkspaceScope = { kind: "owner" }): Promise<WorkspaceStub> {
  const stub = sandboxStub(workspaceNamespace(env) as unknown as DurableObjectNamespace<Sandbox>, workspaceSandboxId(identity.email, scope)) as unknown as WorkspaceStub;
  await stub.bind({ ownerEmail: identity.email, scope });
  return stub;
}
