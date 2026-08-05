import { getWorkspace, withWorkspace, type DurableObjectStorageLike, type WorkspaceHandle } from "@cloudflare/computer";
import { DurableObject } from "cloudflare:workers";
import type { AccessIdentity } from "./auth";
import {
  computerHealthFromWorkspace,
  grepComputerFilesFromWorkspace,
  listComputerFilesFromWorkspace,
  readComputerFileFromWorkspace,
  withComputerWorkspace,
  writeComputerFileFromWorkspace,
  type ComputerWorkspaceClient,
} from "./computer-filesystem";
import { computerWorkspaceName } from "./computer-owner";
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
) {}

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
  return withOwnerComputerWorkspace(env, identity, computerHealthFromWorkspace);
}

export function createComputerWorkProvider(ctx: Pick<ToolContext, "env" | "identity">) {
  const open = <T>(operation: (workspace: ComputerWorkspaceClient) => Promise<T>) =>
    withOwnerComputerWorkspace(ctx.env, ctx.identity, operation);
  return {
    fns: {
      read: (input: unknown) => open((workspace) => readComputerFileFromWorkspace(workspace, input)),
      write: (input: unknown) => open((workspace) => writeComputerFileFromWorkspace(workspace, input)),
      list: (input: unknown) => open((workspace) => listComputerFilesFromWorkspace(workspace, input)),
      grep: (input: unknown) => open((workspace) => grepComputerFilesFromWorkspace(workspace, input)),
    },
  };
}
