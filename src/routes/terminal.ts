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
    return withTerminal.terminal(c.req.raw, { cols, rows });
  });
}
