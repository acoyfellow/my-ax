import type { Context } from "hono";
import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import type { ApiResponse } from "../types";
import { normalizeComputerId, screenContainerPath } from "../computer-id";
import { COMPUTER_SCREEN_PORT, ensureComputerDisplay, getNamedComputer, listNamedComputers } from "../named-computer";

export function screenUpstreamUrl(requestUrl: string, containerPath: string): string {
  return `http://localhost:${COMPUTER_SCREEN_PORT}${containerPath}${new URL(requestUrl).search}`;
}

async function proxyScreen(c: Context<AppEnv>) {
  let computerId: string;
  let rest: string;
  try {
    computerId = normalizeComputerId(String(c.req.param("id") ?? ""));
    rest = screenContainerPath(new URL(c.req.url).pathname, computerId);
  } catch (error) {
    return c.json<ApiResponse>({
      ok: false,
      command: c.req.path,
      error: { code: "BAD_REQUEST", message: error instanceof Error ? error.message : String(error) },
      next_actions: [],
    }, 400);
  }
  try {
    const { sandbox } = await getNamedComputer(c.env, c.get("identity"), computerId);
    await ensureComputerDisplay(sandbox);
    const upstream = new Request(screenUpstreamUrl(c.req.url, rest), c.req.raw);
    if ((c.req.header("Upgrade") ?? "").toLowerCase() === "websocket") {
      return sandbox.wsConnect(upstream, COMPUTER_SCREEN_PORT);
    }
    return await sandbox.containerFetch(upstream, COMPUTER_SCREEN_PORT);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json<ApiResponse>({
      ok: false,
      command: c.req.path,
      error: { code: "COMPUTER_DISPLAY_FAILED", message },
      next_actions: [],
    }, 502);
  }
}

export function registerComputerRoutes(app: Hono<AppEnv>) {
  app.get("/api/computers", async (c) => {
    const computers = await listNamedComputers(c.env, c.get("identity"));
    return c.json<ApiResponse>({ ok: true, command: c.req.path, result: { computers }, next_actions: [] });
  });

  app.all("/api/computers/:id/screen", (c) => c.redirect(`${c.req.path}/`, 301));
  app.all("/api/computers/:id/screen/*", proxyScreen);
}
