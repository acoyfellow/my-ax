import type { Context, Hono } from "hono";
import type { AppEnv } from "../app-env";
import { forkPiChat, openPiChat } from "../pi-engine/routes";
import { createWorkspaceDirectory, WorkspaceNotOwned } from "../workspace-directory";
import { workspaceFor } from "../workspace";
import { publishWorkspaceChange, workspaceHub } from "../workspace-hub-client";

function directoryFor(c: Context<AppEnv>) {
  const email = c.get("identity").email;
  return createWorkspaceDirectory(c.env, email, { openChat: openPiChat, forkChat: forkPiChat, workspace: workspaceFor, publish: (change) => publishWorkspaceChange(c.env, email, change) });
}

function failure(c: Context<AppEnv>, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = error instanceof WorkspaceNotOwned ? 404 : 400;
  return c.json({ ok: false, command: c.req.path, error: { code: status === 404 ? "WORKSPACE_NOT_FOUND" : "WORKSPACE_REQUEST_FAILED", message }, next_actions: [] }, status);
}

export function registerWorkspaceDirectoryRoutes(app: Hono<AppEnv>) {
  app.get("/api/workspaces/events", async (c) => {
    const hub = workspaceHub(c.env, c.get("identity").email);
    if (!hub) return c.json({ ok: false, command: c.req.path, error: { code: "HUB_UNAVAILABLE", message: "the workspace hub is not configured" }, next_actions: [] }, 503);
    if (c.req.header("Upgrade")?.toLowerCase() === "websocket") return hub.fetch(c.req.raw);
    const since = Number(c.req.query("since") ?? "0") || 0;
    const events = await hub.since(since, { workspaces: c.req.queries("workspace") ?? [], kinds: c.req.queries("kind") ?? [] });
    return c.json({ ok: true, command: c.req.path, result: { events }, next_actions: [] });
  });

  app.get("/api/workspaces", async (c) => {
    const workspaces = await directoryFor(c).list(Number(c.req.query("limit")) || 50);
    return c.json({ ok: true, command: c.req.path, result: { workspaces }, next_actions: [] });
  });

  app.post("/api/workspaces/:id/messages", async (c) => {
    const body = await c.req.json<{ from?: string; text?: string }>().catch(() => ({} as { from?: string; text?: string }));
    if (!body.text?.trim()) return failure(c, new Error("text is required"));
    try {
      const directory = directoryFor(c);
      const from = body.from?.trim() || "owner";
      await directory.get(from);
      const result = await directory.message(from, c.req.param("id"), body.text, c.req.header("Idempotency-Key") ?? undefined);
      return c.json({ ok: true, command: c.req.path, result, next_actions: [] });
    } catch (error) {
      return failure(c, error);
    }
  });

  app.post("/api/workspaces/:id/fork", async (c) => {
    const body = await c.req.json<{ atMessageId?: string }>().catch(() => ({} as { atMessageId?: string }));
    if (!body.atMessageId) return failure(c, new Error("atMessageId is required"));
    try {
      const result = await directoryFor(c).fork(c.req.param("id"), body.atMessageId);
      return c.json({ ok: true, command: c.req.path, result, next_actions: [] });
    } catch (error) {
      return failure(c, error);
    }
  });

  app.get("/api/workspaces/:id/files", async (c) => {
    const path = c.req.query("path") ?? "";
    if (!path) return failure(c, new Error("path is required"));
    try {
      const content = await directoryFor(c).readFile(c.req.param("id"), path);
      return c.json({ ok: true, command: c.req.path, result: { path, content }, next_actions: [] });
    } catch (error) {
      return failure(c, error);
    }
  });

  app.put("/api/workspaces/:id/files", async (c) => {
    const body = await c.req.json<{ path?: string; content?: string }>().catch(() => ({} as { path?: string; content?: string }));
    if (!body.path || typeof body.content !== "string") return failure(c, new Error("path and content are required"));
    try {
      const result = await directoryFor(c).writeFile(c.req.param("id"), body.path, body.content);
      return c.json({ ok: true, command: c.req.path, result, next_actions: [] });
    } catch (error) {
      return failure(c, error);
    }
  });
}
