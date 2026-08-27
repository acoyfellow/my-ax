import { getSandbox, type PtyOptions, type Sandbox } from "@cloudflare/sandbox";
import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { isWebSocketUpgrade, terminalDimensions } from "../terminal-protocol";
import { getUserWorkspace, invalidateUserWorkspace } from "../workspace";

export function registerTerminalRoutes(app: Hono<AppEnv>) {
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

  app.get("/api/workspace/terminal", async (c) => {
    if (!isWebSocketUpgrade(c.req.header("Upgrade"))) {
      return c.json({ ok: false, command: c.req.path, error: { code: "UPGRADE_REQUIRED", message: "the terminal endpoint needs a WebSocket upgrade" }, next_actions: [] }, 426);
    }
    const identity = c.get("identity");
    const { sandbox } = await getUserWorkspace(c.env, identity);
    const { cols, rows } = terminalDimensions({ cols: c.req.query("cols"), rows: c.req.query("rows") });
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
