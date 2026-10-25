import type { Hono } from "hono";
import { Effect } from "effect";
import type { AppEnv } from "../app-env";
import { isWebSocketUpgrade, terminalDimensions } from "../terminal-protocol";
import { listWorkspaceSnapshots, restoreWorkspaceSnapshot, snapshotUserWorkspace, workspaceFor } from "../workspace";
import { persistBeforeWorkspaceDestroy } from "../workspace-recycle";

export function registerTerminalRoutes(app: Hono<AppEnv>) {
  app.post("/api/workspace/snapshot", async (c) => {
    const identity = c.get("identity");
    try {
      const backup = await snapshotUserWorkspace(c.env, identity, "terminal");
      return c.json({ ok: true, command: c.req.path, result: { backupId: backup.id }, next_actions: [] });
    } catch (error) {
      return c.json({ ok: false, command: c.req.path, error: { code: "WORKSPACE_SNAPSHOT_FAILED", message: error instanceof Error ? error.message : String(error) }, next_actions: [] }, 502);
    }
  });

  app.get("/api/workspace/snapshots", async (c) => {
    const snapshots = await listWorkspaceSnapshots(c.env, c.get("identity"), Number(c.req.query("limit")) || 20);
    return c.json({ ok: true, command: c.req.path, result: { snapshots }, next_actions: [] });
  });

  app.post("/api/workspace/restore", async (c) => {
    const body = await c.req.json<{ backupId?: string }>().catch(() => ({} as { backupId?: string }));
    const backupId = body.backupId?.trim() ?? "";
    if (!backupId) return c.json({ ok: false, command: c.req.path, error: { code: "BAD_REQUEST", message: "backupId is required" }, next_actions: [] }, 400);
    try {
      const result = await restoreWorkspaceSnapshot(c.env, c.get("identity"), backupId);
      return c.json({ ok: true, command: c.req.path, result, next_actions: [] });
    } catch (error) {
      return c.json({ ok: false, command: c.req.path, error: { code: "WORKSPACE_RESTORE_FAILED", message: error instanceof Error ? error.message : String(error) }, next_actions: [] }, 409);
    }
  });

  app.post("/api/workspace/recycle", async (c) => {
    const identity = c.get("identity");
    const steps: Record<string, unknown> = {};
    const started = Date.now();
    const workspace = await workspaceFor(c.env, identity);
    try {
      const snapshotAt = Date.now();
      await Effect.runPromise(persistBeforeWorkspaceDestroy(
        () => snapshotUserWorkspace(c.env, identity, "recycle"),
        () => workspace.stopContainer(),
      ));
      steps.snapshotMs = Date.now() - snapshotAt;
      steps.destroyed = true;
    } catch (error) {
      return c.json({ ok: false, command: c.req.path, error: { code: "WORKSPACE_RECYCLE_FAILED", message: error instanceof Error ? error.message : String(error) }, next_actions: [] }, 502);
    }
    steps.destroyMs = Date.now() - started;
    const recheckAt = Date.now();
    try {
      const result = await workspace.shell("echo RECYCLED_OK", { timeout: 25_000 });
      steps.recheck = { ms: Date.now() - recheckAt, stdout: (result.stdout ?? "").trim().slice(0, 40), exitCode: result.exitCode };
    } catch (error) {
      steps.recheck = { ms: Date.now() - recheckAt, threw: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
    }
    steps.totalMs = Date.now() - started;
    return c.json({ ok: true, command: c.req.path, result: steps, next_actions: [] });
  });

  app.get("/api/workspace/terminal", async (c) => {
    if (!isWebSocketUpgrade(c.req.header("Upgrade"))) {
      return c.json({ ok: false, command: c.req.path, error: { code: "UPGRADE_REQUIRED", message: "the terminal endpoint needs a WebSocket upgrade" }, next_actions: [] }, 426);
    }
    const identity = c.get("identity");
    const workspace = await workspaceFor(c.env, identity);
    const { cols, rows } = terminalDimensions({ cols: c.req.query("cols"), rows: c.req.query("rows") });
    try {
      await workspace.awake();
      return await workspace.terminal(c.req.raw, { cols, rows });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ ok: false, command: c.req.path, error: { code: "PTY_FAILED", message }, next_actions: [] }, 502);
    }
  });
}
