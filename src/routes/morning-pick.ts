import type { Context, Hono } from "hono";
import type { AppEnv } from "../app-env";
import type { ApiResponse } from "../types";
import { JobService, JobServiceError } from "../job-service";
import type { JobRow } from "../jobs";
import { MORNING_PICK_CADENCE_SECS, MORNING_PICK_JOB_NAME, MORNING_PICK_PROMPT, MORNING_PICK_QUESTION_PREFIX, morningPickAnswer, morningPickStats, type MorningPickDecisionRow } from "../morning-pick";

const MORNING_PICK_IDEMPOTENCY_KEY = "morning-pick";

function reply(c: Context<AppEnv>, command: string, result: unknown, status: 200 | 201 = 200) {
  return c.json<ApiResponse>({ ok: true, command, result, next_actions: [] }, status);
}

function refuse(c: Context<AppEnv>, command: string, error: unknown) {
  const code = error instanceof JobServiceError ? error.code : "InternalError";
  const status = code === "InvalidInput" ? 400 : code === "NotFound" ? 404 : code === "QuotaExceeded" ? 429 : code === "Conflict" ? 409 : 500;
  return c.json<ApiResponse>({ ok: false, command, error: { code, message: error instanceof Error ? error.message : String(error) }, next_actions: [] }, status);
}

async function morningPickJob(service: JobService): Promise<JobRow | null> {
  const jobs = (await service.list()) as JobRow[];
  return jobs.find((job) => job.name === MORNING_PICK_JOB_NAME) ?? null;
}

async function morningPickDecisions(c: Context<AppEnv>): Promise<MorningPickDecisionRow[]> {
  const rows = await c.env.DB.prepare(
    "SELECT r.id, r.status, r.created_at, (SELECT json_extract(e.data_json, '$.choice') FROM run_events e WHERE e.run_id = r.id AND e.type = 'decision.answered' ORDER BY e.ts DESC LIMIT 1) AS choice FROM runs r WHERE r.owner_email = ? AND json_extract(r.bounds_json, '$.surface') = 'decision' AND r.task_summary LIKE ? ORDER BY r.created_at DESC LIMIT 200",
  ).bind(c.get("identity").email.toLowerCase(), `${MORNING_PICK_QUESTION_PREFIX}%`).all<MorningPickDecisionRow>();
  return rows.results ?? [];
}

export function registerMorningPickRoutes(app: Hono<AppEnv>) {
  app.get("/api/morning-pick", async (c) => {
    const command = "GET /api/morning-pick";
    try {
      const service = new JobService(c.env, c.get("identity").email);
      const [job, decisions] = await Promise.all([morningPickJob(service), morningPickDecisions(c)]);
      return reply(c, command, {
        job,
        stats: morningPickStats(decisions),
        picks: decisions.map((decision) => ({ id: decision.id, createdAt: decision.created_at, answer: morningPickAnswer(decision), href: `/api/decisions/${decision.id}` })),
      });
    } catch (error) {
      return refuse(c, command, error);
    }
  });

  app.post("/api/morning-pick", async (c) => {
    const command = "POST /api/morning-pick";
    const body = await c.req.json<{ sessionId?: unknown }>().catch(() => ({} as { sessionId?: unknown }));
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    if (!sessionId) return c.json<ApiResponse>({ ok: false, command, error: { code: "InvalidInput", message: "sessionId is required" }, next_actions: [] }, 400);
    try {
      const service = new JobService(c.env, c.get("identity").email);
      const existing = await morningPickJob(service);
      if (existing) return reply(c, command, { job: existing, created: false });
      const job = await service.create({ sessionId, threadMode: "specific_session", name: MORNING_PICK_JOB_NAME, prompt: MORNING_PICK_PROMPT, cadenceSecs: MORNING_PICK_CADENCE_SECS, maxRuns: null }, MORNING_PICK_IDEMPOTENCY_KEY);
      return reply(c, command, { job, created: true }, 201);
    } catch (error) {
      return refuse(c, command, error);
    }
  });
}
