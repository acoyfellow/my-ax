// Jobs v0 — owner-authenticated REST routes.
//
// Mirrors the /api/sessions style: owner_email is taken from the verified
// Access identity at the edge and used as the second predicate on every
// query so users only ever see and mutate their own rows. Run-now invokes
// the same bounded dispatch operation used by scheduled execution.

import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ApiResponse } from "../types";
import type { AppEnv } from "../app-env";
import { cancelJobSchedule, computeNextRun, MAX_ACTIVE_JOBS_PER_OWNER, runJobNow, scheduleJob, validateJobInput, type JobRow } from "../jobs";
import { transitionJobPaused } from "../job-state-transition";

const JOB_COLS = "id, owner_email, session_id, name, prompt, cadence_secs, status, next_run_at, last_run_at, last_error, schedule_id, created_at, updated_at";

function err(c: Context<AppEnv>, command: string, code: string, message: string, status: ContentfulStatusCode): Response {
  return c.json<ApiResponse>({ ok: false, command, error: { code, message }, next_actions: [] }, status);
}

export function registerJobRoutes(app: Hono<AppEnv>) {
  // POST /api/jobs — create.
  app.post("/api/jobs", async (c) => {
    const email = c.get("identity").email;
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const parsed = validateJobInput({
      sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
      name: typeof body.name === "string" ? body.name : undefined,
      prompt: typeof body.prompt === "string" ? body.prompt : undefined,
      cadenceSecs: Number(body.cadenceSecs),
    });
    if ("tag" in parsed) return err(c, "POST /api/jobs", parsed.tag, `${parsed.field}: ${parsed.message}`, 400);
    // Ownership precondition on target session — same shape as inject.
    try {
      const sess = await c.env.DB.prepare("SELECT id FROM sessions WHERE id = ? AND owner_email = ?")
        .bind(parsed.sessionId, email).first<{ id: string }>();
      if (!sess) return err(c, "POST /api/jobs", "NotFound", "session not found or not owned", 404);
    } catch (e) {
      return err(c, "POST /api/jobs", "DBError", e instanceof Error ? e.message : String(e), 500);
    }
    const id = crypto.randomUUID();
    const nextRunAt = computeNextRun(new Date(), parsed.cadenceSecs);
    let createdScheduleId: string | null = null;
    try {
      const count = await c.env.DB.prepare("SELECT count(*) AS count FROM jobs WHERE owner_email = ? AND status = 'active'").bind(email).first<{ count: number }>();
      if ((count?.count ?? 0) >= MAX_ACTIVE_JOBS_PER_OWNER) return err(c, "POST /api/jobs", "QuotaExceeded", `Maximum active jobs is ${MAX_ACTIVE_JOBS_PER_OWNER}`, 429);
      await c.env.DB.prepare(
        "INSERT INTO jobs (id, owner_email, session_id, name, prompt, cadence_secs, status, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, datetime('now'), datetime('now'))",
      ).bind(id, email, parsed.sessionId, parsed.name, parsed.prompt, parsed.cadenceSecs, nextRunAt).run();
      createdScheduleId = await scheduleJob(c.env, { id, owner_email: email, session_id: parsed.sessionId, prompt: parsed.prompt, cadence_secs: parsed.cadenceSecs });
      await c.env.DB.prepare("UPDATE jobs SET schedule_id = ? WHERE id = ? AND owner_email = ?").bind(createdScheduleId, id, email).run();
    } catch (e) {
      if (createdScheduleId) await cancelJobSchedule(c.env, { owner_email: email, session_id: parsed.sessionId, schedule_id: createdScheduleId }).catch(() => undefined);
      await c.env.DB.prepare("DELETE FROM jobs WHERE id = ? AND owner_email = ?").bind(id, email).run().catch(() => undefined);
      return err(c, "POST /api/jobs", "ScheduleFailed", e instanceof Error ? e.message : String(e), 500);
    }
    return c.json<ApiResponse>({
      ok: true, command: "POST /api/jobs",
      result: { id, sessionId: parsed.sessionId, name: parsed.name, cadenceSecs: parsed.cadenceSecs, status: "active", next_run_at: nextRunAt },
      next_actions: [{ command: `POST /api/jobs/${id}/run`, description: "Fire this job now" }],
    }, 201);
  });

  // GET /api/jobs — owner's jobs, newest-updated first.
  app.get("/api/jobs", async (c) => {
    const email = c.get("identity").email;
    try {
      const r = await c.env.DB.prepare(`SELECT ${JOB_COLS} FROM jobs WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 100`).bind(email).all<JobRow>();
      return c.json<ApiResponse>({ ok: true, command: "GET /api/jobs", result: { jobs: r.results ?? [] }, next_actions: [{ command: "POST /api/jobs", description: "Create a new job" }] });
    } catch {
      return c.json<ApiResponse>({ ok: true, command: "GET /api/jobs", result: { jobs: [] }, next_actions: [{ command: "POST /api/jobs", description: "Create a new job" }] });
    }
  });

  // POST /api/jobs/:id/run — fire immediately. Advances next_run_at from now.
  app.post("/api/jobs/:id/run", async (c) => {
    const id = c.req.param("id");
    const email = c.get("identity").email;
    let row: JobRow | null = null;
    try {
      row = await c.env.DB.prepare(`SELECT ${JOB_COLS} FROM jobs WHERE id = ? AND owner_email = ?`).bind(id, email).first<JobRow>();
    } catch (e) {
      return err(c, `POST /api/jobs/${id}/run`, "DBError", e instanceof Error ? e.message : String(e), 500);
    }
    if (!row) return err(c, `POST /api/jobs/${id}/run`, "NotFound", "job not found or not owned", 404);
    const r = await runJobNow(c.env, row);
    return c.json<ApiResponse>({
      ok: r.ok, command: `POST /api/jobs/${id}/run`,
      result: { id, next_run_at: r.next_run_at, fired: r.ok },
      error: r.ok ? undefined : { code: "DispatchFailed", message: r.error ?? "unknown" },
      next_actions: [{ command: "GET /api/jobs", description: "Refresh job list" }],
    }, r.ok ? 200 : 500);
  });

  // POST /api/jobs/:id/pause  { paused?: boolean }   default paused=true.
  // Resume recomputes next_run_at from now so a long-paused job doesn't
  // immediately fire.
  app.post("/api/jobs/:id/pause", async (c) => {
    const id = c.req.param("id");
    const email = c.get("identity").email;
    const body = (await c.req.json().catch(() => ({}))) as { paused?: boolean };
    const paused = body.paused !== false;
    let updated: JobRow;
    try {
      const row = await c.env.DB.prepare(`SELECT ${JOB_COLS} FROM jobs WHERE id = ? AND owner_email = ?`).bind(id, email).first<JobRow>();
      if (!row) return err(c, `POST /api/jobs/${id}/pause`, "NotFound", "job not found or not owned", 404);
      updated = await transitionJobPaused(row, paused, {
        schedule: (job) => scheduleJob(c.env, job),
        cancel: (job) => cancelJobSchedule(c.env, job),
        nextRun: (job) => computeNextRun(new Date(), job.cadence_secs),
        persist: async (job) => {
          const r = await c.env.DB.prepare("UPDATE jobs SET status = ?, schedule_id = ?, next_run_at = ?, updated_at = datetime('now') WHERE id = ? AND owner_email = ?")
            .bind(job.status, job.schedule_id, job.next_run_at, id, email).run();
          if (!r.success || (r.meta?.changes ?? 0) === 0) throw new Error("job not found or not owned");
        },
      });
    } catch (e) {
      return err(c, `POST /api/jobs/${id}/pause`, "DBError", e instanceof Error ? e.message : String(e), 500);
    }
    return c.json<ApiResponse>({ ok: true, command: `POST /api/jobs/${id}/pause`, result: { id, status: updated.status, next_run_at: updated.next_run_at }, next_actions: [{ command: "GET /api/jobs", description: "Refresh job list" }] });
  });

  // DELETE /api/jobs/:id — owner-scoped hard delete.
  app.delete("/api/jobs/:id", async (c) => {
    const id = c.req.param("id");
    const email = c.get("identity").email;
    try {
      const row = await c.env.DB.prepare(`SELECT ${JOB_COLS} FROM jobs WHERE id = ? AND owner_email = ?`).bind(id, email).first<JobRow>();
      if (!row) return err(c, `DELETE /api/jobs/${id}`, "NotFound", "job not found or not owned", 404);
      await cancelJobSchedule(c.env, row);
      const r = await c.env.DB.prepare("DELETE FROM jobs WHERE id = ? AND owner_email = ?").bind(id, email).run();
      if (!r.success || (r.meta?.changes ?? 0) === 0) return err(c, `DELETE /api/jobs/${id}`, "NotFound", "job not found or not owned", 404);
    } catch (e) {
      return err(c, `DELETE /api/jobs/${id}`, "DBError", e instanceof Error ? e.message : String(e), 500);
    }
    return c.json<ApiResponse>({ ok: true, command: `DELETE /api/jobs/${id}`, result: { deleted: id }, next_actions: [{ command: "GET /api/jobs", description: "List remaining jobs" }] });
  });
}
