import type { AppEnv } from "./app-env";
import { assertSeedablePath, resolveWorkspacePath } from "./workspace-path";
import type { WorkspaceScope } from "./workspace-policy";

export type WorkspaceEntry = { id: string; name: string; engine: string; status: string; updatedAt: string };

export class WorkspaceNotOwned extends Error {
  override readonly name = "WorkspaceNotOwned";
}

type Bindings = AppEnv["Bindings"];

export type SiblingFiles = { read(path: string): Promise<string>; write(path: string, content: string): Promise<void> };

export type SiblingChat = { submit(text: string, operationId?: string): Promise<unknown> };

export type DirectoryDeps = {
  openChat: (env: Bindings, ownerEmail: string, chatId: string) => Promise<SiblingChat>;
  workspace: (env: Bindings, identity: { email: string }, scope: WorkspaceScope) => Promise<SiblingFiles>;
  forkChat: (env: Bindings, ownerEmail: string, sourceId: string, sourceName: string, atMessageId: string) => Promise<{ sessionId: string; name: string; messageCount: number }>;
};

const OWNER_WORKSPACE_ID = "owner";

function scopeFor(id: string): WorkspaceScope {
  return id === OWNER_WORKSPACE_ID ? { kind: "owner" } : { kind: "chat", chatId: id };
}

export function siblingMessage(fromId: string, text: string): string {
  return `[message from workspace ${fromId}]\n${text}`;
}

export function createWorkspaceDirectory(env: Bindings, ownerEmail: string, deps: DirectoryDeps) {
  const owner = ownerEmail.toLowerCase();

  const entry = async (id: string): Promise<WorkspaceEntry> => {
    if (id === OWNER_WORKSPACE_ID) return { id, name: "Owner workspace", engine: "owner", status: "active", updatedAt: "" };
    const row = await env.DB.prepare("SELECT id, name, engine, status, updated_at FROM sessions WHERE id = ? AND owner_email = ? AND status != 'archived'")
      .bind(id, owner).first<{ id: string; name: string; engine: string | null; status: string; updated_at: string }>();
    if (!row) throw new WorkspaceNotOwned(`workspace ${id} does not belong to this owner`);
    return { id: row.id, name: row.name, engine: row.engine ?? "think", status: row.status, updatedAt: row.updated_at };
  };

  const siblingPath = (path: string): string => {
    const resolved = resolveWorkspacePath(path);
    assertSeedablePath(resolved);
    return resolved;
  };

  const files = async (id: string) => {
    await entry(id);
    return deps.workspace(env, { email: owner }, scopeFor(id));
  };

  return {
    list: async (limit = 50): Promise<WorkspaceEntry[]> => {
      const rows = await env.DB.prepare("SELECT id, name, engine, status, updated_at FROM sessions WHERE owner_email = ? AND status != 'archived' ORDER BY updated_at DESC LIMIT ?")
        .bind(owner, Math.min(Math.max(limit, 1), 200)).all<{ id: string; name: string; engine: string | null; status: string; updated_at: string }>();
      const chats = (rows.results ?? []).map((row) => ({ id: row.id, name: row.name, engine: row.engine ?? "think", status: row.status, updatedAt: row.updated_at }));
      return [{ id: OWNER_WORKSPACE_ID, name: "Owner workspace", engine: "owner", status: "active", updatedAt: "" }, ...chats];
    },
    get: entry,
    message: async (fromId: string, toId: string, text: string, operationId?: string): Promise<{ delivered: true; to: string }> => {
      const target = await entry(toId);
      if (target.engine !== "pi") throw new Error(`workspace ${toId} cannot receive messages`);
      await (await deps.openChat(env, owner, toId)).submit(siblingMessage(fromId, text), operationId);
      return { delivered: true, to: toId };
    },
    fork: async (sourceId: string, atMessageId: string) => {
      const source = await entry(sourceId);
      if (source.engine !== "pi") throw new Error(`workspace ${sourceId} cannot be forked`);
      return deps.forkChat(env, owner, sourceId, source.name, atMessageId);
    },
    readFile: async (id: string, path: string): Promise<string> => (await files(id)).read(siblingPath(path)),
    writeFile: async (id: string, path: string, content: string): Promise<{ written: number }> => {
      await (await files(id)).write(siblingPath(path), content);
      return { written: content.length };
    },
  };
}

export type WorkspaceDirectory = ReturnType<typeof createWorkspaceDirectory>;
