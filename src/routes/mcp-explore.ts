import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import type { ApiResponse } from "../types";
import * as rpc from "../rpc/contract";
import { EMPTY_EXPLORE } from "../connector-explore";

export const EXPLORER_SESSION_PREFIX = "mcp-explorer-";

export function explorerSessionId(email: string): string {
  return `${EXPLORER_SESSION_PREFIX}${email.toLowerCase().replace(/[^a-z0-9]/g, "-")}`.slice(0, 120);
}

async function explorerAgent(c: { env: AppEnv["Bindings"]; get: (key: "identity") => AppEnv["Variables"]["identity"] }) {
  const identity = c.get("identity");
  const { getConnectorAgent } = await import("../agent-stub");
  return rpc.command("Connector.open", () => getConnectorAgent(c.env, identity));
}

async function recordTryIt(env: AppEnv["Bindings"], email: string, receipt: { server: string; tool: string; ok: boolean; ms: number }) {
  await env.DB.prepare("INSERT INTO command_usage (owner_email, command_id, kind, ok, ms, used_at) VALUES (?, ?, 'mcp-try', ?, ?, datetime('now'))")
    .bind(email.toLowerCase(), `${receipt.server}.${receipt.tool}`, receipt.ok ? 1 : 0, receipt.ms)
    .run()
    .catch((error: unknown) => console.error("mcp_try_receipt_failed", { err: String(error) }));
}

export function registerMcpExploreRoutes(app: Hono<AppEnv>) {
  app.get("/api/mcps/explore", async (c) => {
    try {
      const agent = await explorerAgent(c);
      const result = await rpc.query("Connector.explore", () => agent.connectorExplore(), 45_000);
      return c.json<ApiResponse>({ ok: true, command: c.req.path, result, next_actions: [] });
    } catch (error) {
      return c.json<ApiResponse>({ ok: false, command: c.req.path, result: EMPTY_EXPLORE, error: { message: error instanceof Error ? error.message : String(error), code: "EXPLORE_FAILED" }, next_actions: [] }, 502);
    }
  });

  app.post("/api/mcps/:id/tools/:tool/call", async (c) => {
    const server = c.req.param("id");
    const tool = c.req.param("tool");
    const body = await c.req.json<{ arguments?: Record<string, unknown>; confirmed?: boolean }>().catch(() => ({} as { arguments?: Record<string, unknown>; confirmed?: boolean }));
    if (body.confirmed !== true) {
      return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { message: "Running an MCP tool needs confirmed: true, because tools can change things.", code: "CONFIRM_REQUIRED" }, next_actions: [] }, 400);
    }
    const started = Date.now();
    const email = c.get("identity").email;
    try {
      const agent = await explorerAgent(c);
      const raw = await rpc.command("Connector.callByName", () => agent.connectorCallByName(server, tool, body.arguments ?? {}), 60_000);
      const ms = Date.now() - started;
      await recordTryIt(c.env, email, { server, tool, ok: true, ms });
      return c.json<ApiResponse>({ ok: true, command: c.req.path, result: { server, tool, ms, output: JSON.parse(raw) }, next_actions: [] });
    } catch (error) {
      const ms = Date.now() - started;
      await recordTryIt(c.env, email, { server, tool, ok: false, ms });
      return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { message: error instanceof Error ? error.message : String(error), code: "TOOL_CALL_FAILED" }, next_actions: [] }, 502);
    }
  });
}
