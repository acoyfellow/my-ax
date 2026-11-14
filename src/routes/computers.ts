import type { Context } from "hono";
import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import type { ApiResponse } from "../types";
import { normalizeComputerId, screenContainerPath } from "../computer-id";
import { COMPUTER_SCREEN_PORT, deleteComputer, ensureComputerDisplay, getComputerRow, getNamedComputer, listNamedComputers, recordComputer, renameComputer, snapshotNamedComputer } from "../named-computer";

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

class ComputerNotFound extends Error {
  constructor() {
    super("Computer not found.");
  }
}

async function computerResult(c: Context<AppEnv>, work: () => Promise<unknown>, okStatus: 200 | 201 = 200) {
  try {
    return c.json<ApiResponse>({ ok: true, command: c.req.path, result: await work(), next_actions: [] }, okStatus);
  } catch (error) {
    const notFound = error instanceof ComputerNotFound;
    return c.json<ApiResponse>({
      ok: false,
      command: c.req.path,
      error: { code: notFound ? "NOT_FOUND" : "BAD_REQUEST", message: error instanceof Error ? error.message : String(error) },
      next_actions: [],
    }, notFound ? 404 : 400);
  }
}

export function registerComputerRoutes(app: Hono<AppEnv>) {
  app.get("/api/computers", async (c) => {
    const computers = await listNamedComputers(c.env, c.get("identity"));
    return c.json<ApiResponse>({ ok: true, command: c.req.path, result: { computers }, next_actions: [] });
  });

  app.post("/api/computers", async (c) => {
    const body = await c.req.json<{ id?: string; title?: string }>().catch(() => ({}) as { id?: string; title?: string });
    return computerResult(c, async () => {
      const row = await recordComputer(c.env, c.get("identity"), String(body.id ?? ""), body.title);
      return { computer: row };
    }, 201);
  });

  app.get("/api/computers/:id", async (c) => computerResult(c, async () => {
    const row = await getComputerRow(c.env, c.get("identity"), c.req.param("id"));
    if (!row) throw new ComputerNotFound();
    return { computer: row };
  }));

  app.patch("/api/computers/:id", async (c) => {
    const body = await c.req.json<{ title?: string }>().catch(() => ({}) as { title?: string });
    return computerResult(c, async () => {
      if (!(await renameComputer(c.env, c.get("identity"), c.req.param("id"), String(body.title ?? "")))) throw new ComputerNotFound();
      return { computer: await getComputerRow(c.env, c.get("identity"), c.req.param("id")) };
    });
  });

  app.delete("/api/computers/:id", async (c) => computerResult(c, async () => {
    if (!(await deleteComputer(c.env, c.get("identity"), c.req.param("id")))) throw new ComputerNotFound();
    return { deleted: c.req.param("id") };
  }));

  app.post("/api/computers/:id/snapshot", async (c) => computerResult(c, async () => {
    const snap = await snapshotNamedComputer(c.env, c.get("identity"), c.req.param("id"));
    return { computerId: snap.computerId, backupId: snap.backup.id };
  }));

  app.all("/api/computers/:id/screen", (c) => c.redirect(`${c.req.path}/`, 301));
  app.all("/api/computers/:id/screen/*", proxyScreen);
}
