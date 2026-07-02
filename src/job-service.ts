// Owns: owner-scoped recurring-job application semantics and durable evidence.
// Called by: HTTP jobs routes, canonical Think tools, and owner MCP coordinator.
// Does not own: authentication, native Agent alarm implementation, or presentation.

import type { Env } from "./types";
import { cancelJobSchedule, computeNextRun, MAX_ACTIVE_JOBS_PER_OWNER, runJobNow, scheduleJob, validateJobInput, type JobInput, type JobRow } from "./jobs";

const COLS = "id, owner_email, session_id, thread_mode, name, prompt, cadence_secs, status, next_run_at, last_run_at, last_error, schedule_id, created_at, updated_at";
export type JobAction = "create" | "update" | "pause" | "resume" | "run" | "delete";
export class JobServiceError extends Error { constructor(public code: "InvalidInput" | "NotFound" | "QuotaExceeded" | "Conflict" | "DispatchFailed", message: string) { super(message); } }

type Evidence = { id: string; job_id: string; action: JobAction; ok: number; detail_json: string; created_at: string };
type Runtime = { schedule: typeof scheduleJob; cancel: typeof cancelJobSchedule; run: typeof runJobNow };
const DEFAULT_RUNTIME: Runtime = { schedule: scheduleJob, cancel: cancelJobSchedule, run: runJobNow };
const RUN_LEASE_MS = 5 * 60 * 1000;

export class JobService {
  constructor(private env: Env, private owner: string, private now = () => new Date(), private runtime: Runtime = DEFAULT_RUNTIME) { this.owner = owner.toLowerCase(); }

  private async owned(id: string): Promise<JobRow> {
    const row = await this.env.DB.prepare(`SELECT ${COLS} FROM jobs WHERE id = ? AND owner_email = ?`).bind(id, this.owner).first<JobRow>();
    if (!row) throw new JobServiceError("NotFound", "job not found or not owned");
    return row;
  }
  private async evidence(jobId: string, action: JobAction, ok: boolean, detail: unknown) {
    await this.env.DB.prepare("INSERT INTO job_events (id, job_id, owner_email, action, ok, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), jobId, this.owner, action, ok ? 1 : 0, JSON.stringify(detail), this.now().toISOString()).run();
  }
  async list(status?: JobRow["status"]) {
    const rows = status
      ? await this.env.DB.prepare(`SELECT ${COLS} FROM jobs WHERE owner_email = ? AND status = ? ORDER BY updated_at DESC LIMIT 100`).bind(this.owner, status).all<JobRow>()
      : await this.env.DB.prepare(`SELECT ${COLS} FROM jobs WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 100`).bind(this.owner).all<JobRow>();
    return rows.results ?? [];
  }
  async history(id: string) {
    const rows = await this.env.DB.prepare("SELECT id, job_id, action, ok, detail_json, created_at FROM job_events WHERE job_id = ? AND owner_email = ? ORDER BY created_at DESC LIMIT 100").bind(id, this.owner).all<Evidence>();
    if (rows.results?.length) return rows.results;
    // Existing jobs with no events are valid legacy rows; deleted jobs are
    // discoverable only through their retained owner-scoped evidence.
    await this.owned(id);
    return [];
  }
  async create(input: Partial<JobInput>, idempotencyKey?: string) {
    const parsed = validateJobInput(input);
    if ("tag" in parsed) throw new JobServiceError("InvalidInput", `${parsed.field}: ${parsed.message}`);
    if (idempotencyKey) {
      const prior = await this.env.DB.prepare(`SELECT ${COLS} FROM jobs WHERE owner_email = ? AND idempotency_key = ?`).bind(this.owner, idempotencyKey).first<JobRow>();
      if (prior) return prior;
    }
    const session = await this.env.DB.prepare("SELECT id FROM sessions WHERE id = ? AND owner_email = ?").bind(parsed.sessionId, this.owner).first();
    if (!session) throw new JobServiceError("NotFound", "session not found or not owned");
    const count = await this.env.DB.prepare("SELECT count(*) count FROM jobs WHERE owner_email = ? AND status = 'active'").bind(this.owner).first<{ count: number }>();
    if ((count?.count ?? 0) >= MAX_ACTIVE_JOBS_PER_OWNER) throw new JobServiceError("QuotaExceeded", `Maximum active jobs is ${MAX_ACTIVE_JOBS_PER_OWNER}`);
    const id = crypto.randomUUID();
    const next = computeNextRun(this.now(), parsed.cadenceSecs);
    await this.env.DB.prepare("INSERT INTO jobs (id, owner_email, session_id, thread_mode, name, prompt, cadence_secs, status, next_run_at, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, datetime('now'), datetime('now'))")
      .bind(id, this.owner, parsed.sessionId, parsed.threadMode, parsed.name, parsed.prompt, parsed.cadenceSecs, next, idempotencyKey ?? null).run();
    let scheduleId: string | null = null;
    try {
      scheduleId = await this.runtime.schedule(this.env, { id, owner_email: this.owner, session_id: parsed.sessionId, thread_mode: parsed.threadMode, prompt: parsed.prompt, cadence_secs: parsed.cadenceSecs });
      await this.env.DB.prepare("UPDATE jobs SET schedule_id = ? WHERE id = ? AND owner_email = ?").bind(scheduleId, id, this.owner).run();
      await this.evidence(id, "create", true, { scheduleId });
      return this.owned(id);
    } catch (error) {
      if (scheduleId) await this.runtime.cancel(this.env, { owner_email: this.owner, session_id: parsed.sessionId, schedule_id: scheduleId }).catch(() => undefined);
      await this.env.DB.prepare("DELETE FROM jobs WHERE id = ? AND owner_email = ?").bind(id, this.owner).run().catch(() => undefined);
      throw error;
    }
  }
  async update(id: string, patch: Partial<JobInput>) {
    const old = await this.owned(id);
    const parsed = validateJobInput({ sessionId: patch.sessionId ?? old.session_id, threadMode: patch.threadMode ?? old.thread_mode, name: patch.name ?? old.name, prompt: patch.prompt ?? old.prompt, cadenceSecs: patch.cadenceSecs ?? old.cadence_secs });
    if ("tag" in parsed) throw new JobServiceError("InvalidInput", `${parsed.field}: ${parsed.message}`);
    const session = await this.env.DB.prepare("SELECT id FROM sessions WHERE id = ? AND owner_email = ?").bind(parsed.sessionId, this.owner).first();
    if (!session) throw new JobServiceError("NotFound", "session not found or not owned");
    let replacement: string | null = null;
    if (old.status === "active") replacement = await this.runtime.schedule(this.env, { id, owner_email: this.owner, session_id: parsed.sessionId, thread_mode: parsed.threadMode, prompt: parsed.prompt, cadence_secs: parsed.cadenceSecs });
    try {
      const next = old.status === "active" ? computeNextRun(this.now(), parsed.cadenceSecs) : old.next_run_at;
      await this.env.DB.prepare("UPDATE jobs SET session_id=?, thread_mode=?, name=?, prompt=?, cadence_secs=?, next_run_at=?, schedule_id=?, updated_at=datetime('now') WHERE id=? AND owner_email=?")
        .bind(parsed.sessionId, parsed.threadMode, parsed.name, parsed.prompt, parsed.cadenceSecs, next, replacement, id, this.owner).run();
    } catch (error) {
      if (replacement) await this.runtime.cancel(this.env, { owner_email: this.owner, session_id: parsed.sessionId, schedule_id: replacement }).catch(() => undefined);
      throw error;
    }
    if (old.schedule_id) {
      try { await this.runtime.cancel(this.env, old); }
      catch (error) {
        // A possibly orphaned old alarm may double-fire once until reconciliation;
        // retaining the known-live replacement is safer than restoring a dead id.
        await this.runtime.cancel(this.env, old).catch(() => undefined);
        const message = "old alarm may still be orphaned";
        await this.env.DB.prepare("UPDATE jobs SET last_error=? WHERE id=? AND owner_email=?").bind(message, id, this.owner).run();
        await this.evidence(id, "update", true, { replacement, orphanedOldScheduleId: old.schedule_id, oldCancelError: String(error) });
        return this.owned(id);
      }
    }
    await this.evidence(id, "update", true, { replacement });
    return this.owned(id);
  }
  async setPaused(id: string, paused: boolean) {
    const row = await this.owned(id);
    if ((paused && row.status === "paused") || (!paused && row.status === "active")) return row;
    if (!paused) {
      const count = await this.env.DB.prepare("SELECT count(*) count FROM jobs WHERE owner_email=? AND status='active'").bind(this.owner).first<{count:number}>();
      if ((count?.count ?? 0) >= MAX_ACTIVE_JOBS_PER_OWNER) throw new JobServiceError("QuotaExceeded", `Maximum active jobs is ${MAX_ACTIVE_JOBS_PER_OWNER}`);
      const sid = await this.runtime.schedule(this.env, row);
      try { await this.env.DB.prepare("UPDATE jobs SET status='active', schedule_id=?, next_run_at=?, updated_at=datetime('now') WHERE id=? AND owner_email=?").bind(sid, computeNextRun(this.now(), row.cadence_secs), id, this.owner).run(); }
      catch (e) { await this.runtime.cancel(this.env, { ...row, schedule_id: sid }).catch(() => undefined); throw e; }
    } else {
      await this.runtime.cancel(this.env, row);
      try {
        await this.env.DB.prepare("UPDATE jobs SET status='paused', schedule_id=NULL, updated_at=datetime('now') WHERE id=? AND owner_email=?").bind(id, this.owner).run();
      } catch (error) {
        const replacement = await this.runtime.schedule(this.env, row).catch(() => null);
        if (replacement) await this.env.DB.prepare("UPDATE jobs SET schedule_id=? WHERE id=? AND owner_email=?").bind(replacement, id, this.owner).run().catch(() => undefined);
        throw error;
      }
    }
    await this.evidence(id, paused ? "pause" : "resume", true, {});
    return this.owned(id);
  }
  async run(id: string, idempotencyKey?: string) {
    const row = await this.owned(id);
    const now = this.now();
    let eventId: string = crypto.randomUUID();
    if (idempotencyKey) {
      const prior = await this.env.DB.prepare("SELECT id, ok, detail_json FROM job_events WHERE job_id=? AND owner_email=? AND action='run' AND idempotency_key=?").bind(id, this.owner, idempotencyKey).first<{id:string;ok:number;detail_json:string}>();
      if (prior) {
        const detail = JSON.parse(prior.detail_json);
        if (!detail.pending) {
          if (!prior.ok) throw new JobServiceError("DispatchFailed", detail.error ?? "dispatch failed");
          return detail;
        }
        if (detail.leaseExpiresAt && now < new Date(detail.leaseExpiresAt)) throw new JobServiceError("Conflict", "an idempotent run with this key is already in progress");
        eventId = prior.id;
        await this.env.DB.prepare("UPDATE job_events SET ok=0, detail_json=? WHERE id=? AND owner_email=?")
          .bind(JSON.stringify({ pending: true, leaseExpiresAt: new Date(now.getTime() + RUN_LEASE_MS).toISOString() }), eventId, this.owner).run();
      } else {
        // Reserve the key before dispatch so concurrent retries cannot inject the
        // same prompt twice. The row is updated with the authoritative result.
        try {
          await this.env.DB.prepare("INSERT INTO job_events (id, job_id, owner_email, action, ok, detail_json, idempotency_key, created_at) VALUES (?, ?, ?, 'run', 0, ?, ?, ?)")
            .bind(eventId, id, this.owner, JSON.stringify({ pending: true, leaseExpiresAt: new Date(now.getTime() + RUN_LEASE_MS).toISOString() }), idempotencyKey, now.toISOString()).run();
        } catch {
          throw new JobServiceError("Conflict", "an idempotent run with this key already exists");
        }
      }
    }
    const result = await this.runtime.run(this.env, row, this.now());
    if (idempotencyKey) {
      await this.env.DB.prepare("UPDATE job_events SET ok=?, detail_json=? WHERE id=? AND owner_email=?")
        .bind(result.ok ? 1 : 0, JSON.stringify(result), eventId, this.owner).run();
    } else {
      await this.env.DB.prepare("INSERT INTO job_events (id, job_id, owner_email, action, ok, detail_json, idempotency_key, created_at) VALUES (?, ?, ?, 'run', ?, ?, NULL, ?)")
        .bind(eventId, id, this.owner, result.ok ? 1 : 0, JSON.stringify(result), this.now().toISOString()).run();
    }
    if (!result.ok) throw new JobServiceError("DispatchFailed", result.error ?? "dispatch failed");
    return result;
  }
  async delete(id: string) {
    const row = await this.owned(id);
    await this.runtime.cancel(this.env, row);
    try {
      await this.evidence(id, "delete", true, { snapshot: { name: row.name, sessionId: row.session_id, threadMode: row.thread_mode } });
      await this.env.DB.prepare("DELETE FROM jobs WHERE id=? AND owner_email=?").bind(id, this.owner).run();
    } catch (error) {
      if (row.status === "active") {
        const replacement = await this.runtime.schedule(this.env, row).catch(() => null);
        if (replacement) await this.env.DB.prepare("UPDATE jobs SET schedule_id=? WHERE id=? AND owner_email=?").bind(replacement, id, this.owner).run().catch(() => undefined);
      }
      throw error;
    }
    return { deleted: id };
  }
}
