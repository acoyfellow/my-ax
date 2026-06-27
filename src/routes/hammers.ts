import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "../app-env";
import type { ApiResponse } from "../types";
import { getSessionAgent } from "../agent-stub";
import { publicHammer, SavedHammerError, SavedHammerService } from "../saved-hammers";
import { requireOwnedSession } from "../session-ownership";

function body(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  return c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
}

function service(c: Context<AppEnv>) {
  return new SavedHammerService(c.env, c.get("identity").email);
}

function failure(c: Context<AppEnv>, command: string, error: unknown) {
  const known = error instanceof SavedHammerError;
  const code = known ? error.code : "InternalError";
  const status: ContentfulStatusCode = code === "InvalidInput" ? 400 : code === "NotFound" ? 404 : code === "Conflict" ? 409 : 500;
  return c.json<ApiResponse>({ ok: false, command, error: { code, message: error instanceof Error ? error.message : String(error) }, next_actions: [] }, status);
}

function ok(c: Context<AppEnv>, command: string, result: unknown, status: ContentfulStatusCode = 200) {
  return c.json<ApiResponse>({ ok: true, command, result, next_actions: [] }, status);
}

export function registerHammerRoutes(app: Hono<AppEnv>) {
  app.get("/api/hammers", async (c) => {
    const command = "GET /api/hammers";
    try { return ok(c, command, { hammers: await service(c).list() }); }
    catch (error) { return failure(c, command, error); }
  });

  app.post("/api/hammers", async (c) => {
    const command = "POST /api/hammers";
    try { return ok(c, command, { hammer: await service(c).create(await body(c)) }, 201); }
    catch (error) { return failure(c, command, error); }
  });

  app.get("/api/hammers/:id", async (c) => {
    const command = `GET /api/hammers/${c.req.param("id")}`;
    try {
      const row = await service(c).get(c.req.param("id"));
      return ok(c, command, { hammer: { ...publicHammer(row), code: row.code } });
    }
    catch (error) { return failure(c, command, error); }
  });

  app.patch("/api/hammers/:id", async (c) => {
    const command = `PATCH /api/hammers/${c.req.param("id")}`;
    try { return ok(c, command, { hammer: await service(c).update(c.req.param("id"), await body(c)) }); }
    catch (error) { return failure(c, command, error); }
  });

  app.delete("/api/hammers/:id", async (c) => {
    const command = `DELETE /api/hammers/${c.req.param("id")}`;
    try { return ok(c, command, await service(c).delete(c.req.param("id"))); }
    catch (error) { return failure(c, command, error); }
  });

  app.post("/api/hammers/:id/run", async (c) => {
    const command = `POST /api/hammers/${c.req.param("id")}/run`;
    try {
      const request = await body(c);
      const sessionId = typeof request.sessionId === "string" ? request.sessionId : "";
      if (!sessionId) throw new SavedHammerError("InvalidInput", "sessionId is required");
      if (!await requireOwnedSession(c.env, sessionId, c.get("identity").email)) throw new SavedHammerError("NotFound", "session not found or not owned");
      const agent = await getSessionAgent(c.env, c.get("identity").email, sessionId);
      const result = await agent.runSavedHammer({ hammerId: c.req.param("id"), input: typeof request.input === "object" && request.input ? request.input as Record<string, unknown> : {} });
      return ok(c, command, result, 202);
    } catch (error) {
      return failure(c, command, error);
    }
  });
}
