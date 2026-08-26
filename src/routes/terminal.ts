import { getSandbox, type PtyOptions, type Sandbox } from "@cloudflare/sandbox";
import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { getUserWorkspace, invalidateUserWorkspace } from "../workspace";

export const TERMINAL_DEFAULT_COLS = 80;
export const TERMINAL_DEFAULT_ROWS = 24;

function boundedDimension(raw: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export function registerTerminalRoutes(app: Hono<AppEnv>) {
  app.get("/api/workspace/terminal-probe", async (c) => {
    const identity = c.get("identity");
    const started = Date.now();
    const steps: Record<string, unknown> = {};
    try {
      const { sandbox } = await getUserWorkspace(c.env, identity, { restoreLatest: false });
      steps.workspaceMs = Date.now() - started;
      steps.hasTerminal = typeof (sandbox as unknown as { terminal?: unknown }).terminal === "function";
      const execAt = Date.now();
      const result = await sandbox.exec("echo PROBE_OK", { timeout: 20_000 });
      steps.execMs = Date.now() - execAt;
      steps.execStdout = (result.stdout ?? "").trim().slice(0, 80);
      const ptyAt = Date.now();
      const upgrade = new Request("https://internal/ws/pty", { headers: { Upgrade: "websocket", Connection: "Upgrade" } });
      const response = await (sandbox as unknown as { terminal: (r: Request, o?: PtyOptions) => Promise<Response> })
        .terminal(upgrade, { cols: 80, rows: 24 });
      steps.ptyMs = Date.now() - ptyAt;
      steps.ptyStatus = response.status;
      steps.ptyHasWebSocket = Boolean((response as unknown as { webSocket?: unknown }).webSocket);
      steps.ptyBody = response.status === 101 ? "(switching protocols)" : (await response.text()).slice(0, 200);
    } catch (error) {
      steps.threw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      steps.stack = error instanceof Error ? String(error.stack ?? "").slice(0, 400) : "";
    }
    steps.totalMs = Date.now() - started;
    return c.json({ ok: true, command: c.req.path, result: steps, next_actions: [] });
  });
  app.get("/api/workspace/restore-probe", async (c) => {
    const identity = c.get("identity");
    const steps: Record<string, unknown> = {};
    const started = Date.now();
    try {
      const row = await c.env.DB.prepare(
        "SELECT backup_id, backup_dir FROM workspace_snapshots WHERE owner_email = ?",
      ).bind(identity.email.toLowerCase()).first<{ backup_id: string; backup_dir: string }>();
      steps.pointer = row ? { backupId: row.backup_id, backupDir: row.backup_dir } : null;
      if (row) {
        const { sandbox } = await getUserWorkspace(c.env, identity, { restoreLatest: false });
        const attemptAt = Date.now();
        try {
          const restored = await sandbox.restoreBackup({ id: row.backup_id, dir: row.backup_dir });
          steps.restoreMs = Date.now() - attemptAt;
          steps.restoreRaw = { success: restored.success, id: restored.id, dir: restored.dir };
        } catch (inner) {
          steps.restoreMs = Date.now() - attemptAt;
          steps.restoreThrew = inner instanceof Error ? `${inner.name}: ${inner.message}` : String(inner);
        }
      }
    } catch (error) {
      steps.threw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
    steps.totalMs = Date.now() - started;
    return c.json({ ok: true, command: c.req.path, result: steps, next_actions: [] });
  });

  app.post("/api/workspace/recycle", async (c) => {
    const identity = c.get("identity");
    const namespace = (c.env as unknown as { SANDBOX: DurableObjectNamespace<Sandbox> }).SANDBOX;
    const steps: Record<string, unknown> = {};
    const started = Date.now();
    const stub = getSandbox(namespace, identity.email.toLowerCase(), {
      containerTimeouts: { instanceGetTimeoutMS: 25_000, portReadyTimeoutMS: 35_000 },
      transport: "rpc",
    });
    try {
      await (stub as unknown as { destroy: () => Promise<void> }).destroy();
      steps.destroyed = true;
    } catch (error) {
      steps.destroyThrew = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
    steps.destroyMs = Date.now() - started;
    const recheckAt = Date.now();
    try {
      const result = await stub.exec("echo RECYCLED_OK", { timeout: 25_000 });
      steps.recheck = { ms: Date.now() - recheckAt, stdout: (result.stdout ?? "").trim().slice(0, 40), exitCode: result.exitCode };
    } catch (error) {
      steps.recheck = { ms: Date.now() - recheckAt, threw: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
    }
    steps.totalMs = Date.now() - started;
    invalidateUserWorkspace(identity);
    return c.json({ ok: true, command: c.req.path, result: steps, next_actions: [] });
  });

  app.get("/api/workspace/transport-probe", async (c) => {
    const identity = c.get("identity");
    const steps: Record<string, unknown> = {};
    const namespace = (c.env as unknown as { SANDBOX: DurableObjectNamespace<Sandbox> }).SANDBOX;
    const requested = c.req.query("transport") === "rpc" ? "rpc" : "http";
    for (const transport of [requested] as const) {
      const at = Date.now();
      const sandboxId = c.req.query("fresh") === "1" ? `probe-${Date.now()}` : identity.email.toLowerCase();
      try {
        const stub = getSandbox(namespace, sandboxId, {
          containerTimeouts: { instanceGetTimeoutMS: 25_000, portReadyTimeoutMS: 35_000 },
          transport,
        });
        const result = await stub.exec("echo TRANSPORT_OK", { timeout: 20_000 });
        const ptyAt = Date.now();
        const upgrade = new Request("https://internal/ws/pty", { headers: { Upgrade: "websocket", Connection: "Upgrade" } });
        const ptyResponse = await (stub as unknown as { terminal: (r: Request, o?: PtyOptions) => Promise<Response> })
          .terminal(upgrade, { cols: 80, rows: 24 });
        steps.pty = {
          ms: Date.now() - ptyAt,
          status: ptyResponse.status,
          hasWebSocket: Boolean((ptyResponse as unknown as { webSocket?: unknown }).webSocket),
          body: ptyResponse.status === 101 ? "(switching protocols)" : (await ptyResponse.text()).slice(0, 200),
        };
        steps[transport] = { ms: Date.now() - at, sandboxId, stdout: (result.stdout ?? "").trim().slice(0, 40), exitCode: result.exitCode };
      } catch (error) {
        steps[transport] = { ms: Date.now() - at, sandboxId, threw: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
      }
    }
    return c.json({ ok: true, command: c.req.path, result: steps, next_actions: [] });
  });


  app.get("/api/workspace/terminal", async (c) => {
    if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
      return c.json({ ok: false, command: c.req.path, error: { code: "UPGRADE_REQUIRED", message: "the terminal endpoint needs a WebSocket upgrade" }, next_actions: [] }, 426);
    }
    const identity = c.get("identity");
    const { sandbox } = await getUserWorkspace(c.env, identity);
    const cols = boundedDimension(c.req.query("cols"), TERMINAL_DEFAULT_COLS, 500);
    const rows = boundedDimension(c.req.query("rows"), TERMINAL_DEFAULT_ROWS, 200);
    const withTerminal = sandbox as unknown as {
      terminal?: (request: Request, options?: PtyOptions) => Promise<Response>;
    };
    if (typeof withTerminal.terminal !== "function") {
      return c.json({ ok: false, command: c.req.path, error: { code: "PTY_UNAVAILABLE", message: "this sandbox build serves no pty" }, next_actions: [] }, 501);
    }
    try {
      return await withTerminal.terminal(c.req.raw, { cols, rows });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ ok: false, command: c.req.path, error: { code: "PTY_FAILED", message }, next_actions: [] }, 502);
    }
  });
}
