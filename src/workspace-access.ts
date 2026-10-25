import { isDeadSandboxError } from "./workspace-exec";

export interface WorkspaceAccess<S> {
  acquire(): Promise<S>;
  destroy(): Promise<void>;
}

export type WorkspaceOperationKind = "idempotent" | "side-effecting";

export class WorkspaceDiedMidCommandError extends Error {
  constructor(cause: unknown) {
    super("The workspace container died while this command was running. It has been reset to a fresh container from the last snapshot; the command was not re-run because it may have partially completed.", { cause });
    this.name = "WorkspaceDiedMidCommandError";
  }
}

export async function acquireWithOneReset<S>(access: WorkspaceAccess<S>): Promise<S> {
  try {
    return await access.acquire();
  } catch (error) {
    if (!isDeadSandboxError(error)) throw error;
    await access.destroy();
    return access.acquire();
  }
}

export async function useWorkspace<S, T>(access: WorkspaceAccess<S>, kind: WorkspaceOperationKind, operation: (sandbox: S) => Promise<T>): Promise<T> {
  const sandbox = await acquireWithOneReset(access);
  try {
    return await operation(sandbox);
  } catch (error) {
    if (!isDeadSandboxError(error)) throw error;
    await access.destroy();
    if (kind === "side-effecting") throw new WorkspaceDiedMidCommandError(error);
    return operation(await access.acquire());
  }
}
