import type { Context } from "hono";
import type { AppEnv } from "../app-env";
import * as rpc from "../rpc/contract";
import { WORKSPACE_HOME } from "../workspace-path";

export const FILE_MENTION_LIMIT = 12;

const SKIPPED_SEGMENTS = /(^|\/)(node_modules|\.git|\.cache|dist|build)(\/|$)/;

export function rankFilePaths(paths: string[], query: string, limit = FILE_MENTION_LIMIT): string[] {
  const q = query.toLowerCase();
  return paths
    .filter((path) => !SKIPPED_SEGMENTS.test(path))
    .map((path) => {
      const lower = path.toLowerCase();
      const base = lower.split("/").pop() ?? lower;
      const score = !q ? 1 : base === q ? 100 : base.startsWith(q) ? 60 : base.includes(q) ? 40 : lower.includes(q) ? 20 : 0;
      return { path, score: score - path.split("/").length * 0.1 };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit)
    .map((entry) => entry.path);
}

export async function listWorkspaceFiles(c: Context<AppEnv>, sessionId: string | null, query: string): Promise<string[]> {
  const identity = c.get("identity");
  const { workspaceFor } = await import("../workspace-object");
  const scope = sessionId ? { kind: "chat" as const, chatId: sessionId } : { kind: "owner" as const };
  const files = await rpc.query("Workspace.listForMention", async () => (await workspaceFor(c.env, identity, scope)).list(WORKSPACE_HOME, { recursive: true }), 8_000);
  const relative = files.filter((file) => file.type === "file").map((file) => file.absolutePath.replace(`${WORKSPACE_HOME}/`, ""));
  return rankFilePaths(relative, query);
}
