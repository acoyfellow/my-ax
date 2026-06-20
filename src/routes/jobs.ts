// Owns: HTTP parsing and response mapping for recurring jobs.
// Called by: authenticated Hono application composition.
// Does not own: job business rules, scheduling, ownership, quota, or evidence.

import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "../app-env";
import type { ApiResponse } from "../types";
import { JobService, JobServiceError } from "../job-service";

function failure(c: Context<AppEnv>, command: string, error: unknown) {
  const known = error instanceof JobServiceError;
  const code = known ? error.code : "InternalError";
  const status: ContentfulStatusCode = code === "InvalidInput" ? 400 : code === "NotFound" ? 404 : code === "QuotaExceeded" ? 429 : code === "Conflict" ? 409 : 500;
  return c.json<ApiResponse>({ ok: false, command, error: { code, message: error instanceof Error ? error.message : String(error) }, next_actions: [] }, status);
}

export function registerJobRoutes(app: Hono<AppEnv>) {
  const body = (c: Context<AppEnv>): Promise<Record<string, unknown>> => c.req.json<Record<string, unknown>>().catch(() => ({}));
  const service = (c: Context<AppEnv>) => new JobService(c.env, c.get("identity").email);
  const input = (v: Record<string, unknown>) => ({ sessionId: typeof v.sessionId === "string" ? v.sessionId : undefined, name: typeof v.name === "string" ? v.name : undefined, prompt: typeof v.prompt === "string" ? v.prompt : undefined, cadenceSecs: v.cadenceSecs === undefined ? undefined : Number(v.cadenceSecs) });
  const key = (c: Context<AppEnv>) => c.req.header("Idempotency-Key")?.trim().slice(0, 200);
  const ok = (c: Context<AppEnv>, command: string, result: unknown, status: ContentfulStatusCode = 200) => c.json<ApiResponse>({ ok: true, command, result, next_actions: [] }, status);

  app.get("/api/jobs", async c => { const command = "GET /api/jobs"; try { return ok(c, command, { jobs: await service(c).list() }); } catch (e) { return failure(c, command, e); } });
  app.post("/api/jobs", async c => { const command = "POST /api/jobs"; try { return ok(c, command, await service(c).create(input(await body(c)), key(c)), 201); } catch (e) { return failure(c, command, e); } });
  app.patch("/api/jobs/:id", async c => { const command = `PATCH /api/jobs/${c.req.param("id")}`; try { return ok(c, command, await service(c).update(c.req.param("id"), input(await body(c)))); } catch (e) { return failure(c, command, e); } });
  app.post("/api/jobs/:id/pause", async c => { const command = `POST /api/jobs/${c.req.param("id")}/pause`; try { const request = await body(c); return ok(c, command, await service(c).setPaused(c.req.param("id"), request.paused !== false)); } catch (e) { return failure(c, command, e); } });
  app.post("/api/jobs/:id/resume", async c => { const command = `POST /api/jobs/${c.req.param("id")}/resume`; try { return ok(c, command, await service(c).setPaused(c.req.param("id"), false)); } catch (e) { return failure(c, command, e); } });
  app.post("/api/jobs/:id/run", async c => { const command = `POST /api/jobs/${c.req.param("id")}/run`; try { return ok(c, command, await service(c).run(c.req.param("id"), key(c))); } catch (e) { return failure(c, command, e); } });
  app.delete("/api/jobs/:id", async c => { const command = `DELETE /api/jobs/${c.req.param("id")}`; try { return ok(c, command, await service(c).delete(c.req.param("id"))); } catch (e) { return failure(c, command, e); } });
  app.get("/api/jobs/:id/history", async c => { const command = `GET /api/jobs/${c.req.param("id")}/history`; try { return ok(c, command, { events: await service(c).history(c.req.param("id")) }); } catch (e) { return failure(c, command, e); } });
}
