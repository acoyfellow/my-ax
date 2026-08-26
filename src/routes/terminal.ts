import type { PtyOptions } from "@cloudflare/sandbox";
import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { getUserWorkspace } from "../workspace";

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
      const { sandbox } = await getUserWorkspace(c.env, identity);
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
    }
    steps.totalMs = Date.now() - started;
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
