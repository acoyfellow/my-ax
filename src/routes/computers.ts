import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import type { ApiResponse } from "../types";
import { normalizeComputerId, novncContainerPath } from "../computer-id";
import { getNamedComputer, listNamedComputers } from "../named-computer";

const NOVNC_PORT = 6080;

export function registerComputerRoutes(app: Hono<AppEnv>) {
  app.get("/api/computers", async (c) => {
    const computers = await listNamedComputers(c.env, c.get("identity"));
    return c.json<ApiResponse>({ ok: true, command: c.req.path, result: { computers }, next_actions: [] });
  });

  app.all("/api/computers/:id/novnc/*", async (c) => {
    let computerId: string;
    let rest: string;
    try {
      computerId = normalizeComputerId(c.req.param("id"));
      rest = novncContainerPath(new URL(c.req.url).pathname, computerId);
    } catch (error) {
      return c.json<ApiResponse>({
        ok: false,
        command: c.req.path,
        error: { code: "BAD_REQUEST", message: error instanceof Error ? error.message : String(error) },
        next_actions: [],
      }, 400);
    }
    const { sandbox } = await getNamedComputer(c.env, c.get("identity"), computerId);
    const url = new URL(c.req.url);
    if ((c.req.header("Upgrade") ?? "").toLowerCase() === "websocket") {
      const proxied = new Request(`https://computer.invalid${rest}${url.search}`, c.req.raw);
      return sandbox.wsConnect(proxied, NOVNC_PORT);
    }
    return sandbox.containerFetch(`${rest}${url.search}`, { method: c.req.method }, NOVNC_PORT);
  });
}
