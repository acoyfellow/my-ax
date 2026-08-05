import { getWorkspace, withWorkspace, type DurableObjectStorageLike, type WorkspaceHandle } from "@cloudflare/computer";
import { DurableObject } from "cloudflare:workers";
import type { AccessIdentity } from "./auth";
import {
  computerHealthFromWorkspace,
  grepComputerFilesFromWorkspace,
  listComputerFilesFromWorkspace,
  parseComputerWriteInput,
  readComputerFileFromWorkspace,
  withComputerWorkspace,
  writeComputerFileFromWorkspace,
  type ComputerWorkspaceClient,
} from "./computer-filesystem";
import { computerWorkspaceName } from "./computer-owner";
import {
  COMPUTER_RETAINED_WRITE_RESERVATION_BYTES,
  getComputerRetainedWriteBytes,
  withReservedComputerRetainedWrite,
} from "./computer-retained-write-budget";
import type { Env, ToolContext } from "./types";

export * from "./computer-filesystem";
export { computerWorkspaceName, normalizedComputerOwnerEmail } from "./computer-owner";

class ComputerWorkspaceBase extends DurableObject {
  workspaceStorage() {
    return this.ctx.storage;
  }
}

export class ComputerWorkspace extends withWorkspace(
  ComputerWorkspaceBase,
  (self) => ({ storage: self.workspaceStorage() as unknown as DurableObjectStorageLike }),
) {
  #writeTail: Promise<void> = Promise.resolve();

  private serializeWrite<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.#writeTail.then(operation, operation);
    this.#writeTail = next.then(() => undefined, () => undefined);
    return next;
  }

  async write(input: unknown) {
    return this.serializeWrite(async () => {
      parseComputerWriteInput(input);
      return withReservedComputerRetainedWrite(this.ctx.storage, COMPUTER_RETAINED_WRITE_RESERVATION_BYTES, () => withComputerWorkspace(
        () => getWorkspace(this as unknown as WorkspaceHandle) as Promise<ComputerWorkspaceClient>,
        (workspace) => writeComputerFileFromWorkspace(workspace, input),
      ));
    });
  }

  async health() {
    const retainedWriteReservedBytes = await getComputerRetainedWriteBytes(this.ctx.storage);
    return withComputerWorkspace(
      () => getWorkspace(this as unknown as WorkspaceHandle) as Promise<ComputerWorkspaceClient>,
      (workspace) => computerHealthFromWorkspace(workspace, retainedWriteReservedBytes),
    );
  }
}

export async function withOwnerComputerWorkspace<T>(
  env: Pick<Env, "COMPUTER">,
  identity: Pick<AccessIdentity, "email">,
  operation: (workspace: ComputerWorkspaceClient) => Promise<T>,
): Promise<T> {
  const id = env.COMPUTER.idFromName(computerWorkspaceName(identity));
  return withComputerWorkspace(
    () => getWorkspace(env.COMPUTER.get(id) as unknown as WorkspaceHandle) as Promise<ComputerWorkspaceClient>,
    operation,
  );
}

export async function getComputerHealth(env: Pick<Env, "COMPUTER">, identity: Pick<AccessIdentity, "email">) {
  const id = env.COMPUTER.idFromName(computerWorkspaceName(identity));
  return env.COMPUTER.get(id).health();
}

export function createComputerWorkProvider(ctx: Pick<ToolContext, "env" | "identity">) {
  const open = <T>(operation: (workspace: ComputerWorkspaceClient) => Promise<T>) =>
    withOwnerComputerWorkspace(ctx.env, ctx.identity, operation);
  const id = ctx.env.COMPUTER.idFromName(computerWorkspaceName(ctx.identity));
  const computer = ctx.env.COMPUTER.get(id);
  return {
    fns: {
      read: (input: unknown) => open((workspace) => readComputerFileFromWorkspace(workspace, input)),
      write: (input: unknown) => computer.write(input),
      list: (input: unknown) => open((workspace) => listComputerFilesFromWorkspace(workspace, input)),
      grep: (input: unknown) => open((workspace) => grepComputerFilesFromWorkspace(workspace, input)),
    },
  };
}
