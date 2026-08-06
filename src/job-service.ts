import type { Env } from "./types";
import { cancelJobSchedule, computeNextRun, MAX_ACTIVE_JOBS_PER_OWNER, parkRecurringScheduleCancellation, runJobNow, scheduleJob, validateJobInput, type JobInput, type JobRow, type RecurringScheduleCancellation } from "./jobs";

const COLS = "id, owner_email, session_id, thread_mode, name, prompt, cadence_secs, status, next_run_at, last_run_at, last_error, schedule_id, created_at, updated_at, state_version";
export type JobAction = "create" | "update" | "pause" | "resume" | "run" | "delete";
export class JobServiceError extends Error { constructor(public code: "InvalidInput" | "NotFound" | "QuotaExceeded" | "Conflict" | "DispatchFailed", message: string) { super(message); } }

type Evidence = { id: string; job_id: string; action: JobAction; ok: number; detail_json: string; created_at: string };
type Runtime = { schedule: typeof scheduleJob; cancel: typeof cancelJobSchedule; run: typeof runJobNow };
const DEFAULT_RUNTIME: Runtime = { schedule: scheduleJob, cancel: cancelJobSchedule, run: runJobNow };
const RUN_LEASE_MS = 5 * 60 * 1000;

function publicJob(row: JobRow): JobRow {
  const { schedule_id: _schedule, ...job } = row;
  return job as JobRow;
}

function publicEvidence(row: Evidence): Evidence {
  try {
    const detail = JSON.parse(row.detail_json);
    if (detail === null || typeof detail !== "object" || Array.isArray(detail)) return row;
    const { scheduleId: _scheduleId, replacement: _replacement, orphanedOldScheduleId: _orphaned, oldCancelError: _cancelError, fireKey: _fireKey, fireToken: _fireToken, fireVerifier: _fireVerifier, submissionId: _submissionId, receiptId: _receiptId, pendingCancelScheduleId: _pendingCancelScheduleId, pendingCancelSessionId: _pendingCancelSessionId, ...safeDetail } = detail as Record<string, unknown>;
    return { ...row, detail_json: JSON.stringify(safeDetail) };
  } catch {
    return row;
  }
}

export class JobService {
  constructor(private env: Env, private owner: string, private now = () => new Date(), private runtime: Runtime = DEFAULT_RUNTIME) { this.owner = owner.toLowerCase(); }

  private async stored(id: string): Promise<JobRow> {
    const row = await this.env.DB.prepare(`SELECT ${COLS} FROM jobs WHERE id = ? AND owner_email = ?`).bind(id, this.owner).first<JobRow>();
    if (!row) throw new JobServiceError("NotFound", "job not found or not owned");
    return row;
  }

  private async owned(id: string): Promise<JobRow> {
    return publicJob(await this.stored(id));
  }

  private async evidence(jobId: string, action: JobAction, ok: boolean, detail: unknown) {
    await this.env.DB.prepare("INSERT INTO job_events (id, job_id, owner_email, action, ok, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), jobId, this.owner, action, ok ? 1 : 0, JSON.stringify(detail), this.now().toISOString()).run();
  }

  private async parkCancellation(row: Pick<JobRow, "id" | "owner_email">, scheduleId: string, sessionId: string): Promise<void> {
    let parked = false;
    try {
      parked = await parkRecurringScheduleCancellation(this.env, {
        job_id: row.id,
        owner_email: row.owner_email,
        session_id: sessionId,
        schedule_id: scheduleId,
      });
    } catch (error) {
      throw new JobServiceError("Conflict", `schedule cancellation could not be persisted: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!parked) throw new JobServiceError("Conflict", "schedule cancellation could not be persisted");
  }

  private async removeCancellation(cancellation: Pick<RecurringScheduleCancellation, "id" | "owner_email">): Promise<void> {
    const cleared = await this.env.DB.prepare("DELETE FROM recurring_schedule_cancellations WHERE id = ? AND owner_email = ?")
      .bind(cancellation.id, cancellation.owner_email.toLowerCase()).run();
    if (cleared.meta?.changes !== 1) throw new JobServiceError("Conflict", "schedule cancellation changed concurrently");
  }

  private async retryPendingCancellations(row: JobRow): Promise<JobRow> {
    const queued = await this.env.DB.prepare("SELECT id, job_id, owner_email, session_id, schedule_id, created_at FROM recurring_schedule_cancellations WHERE job_id = ? AND owner_email = ? ORDER BY created_at ASC, id ASC")
      .bind(row.id, this.owner).all<RecurringScheduleCancellation>();
    let failure: unknown = null;
    for (const cancellation of queued.results ?? []) {
      try {
        await this.runtime.cancel(this.env, { ...row, owner_email: cancellation.owner_email, session_id: cancellation.session_id, schedule_id: cancellation.schedule_id });
        await this.removeCancellation(cancellation);
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure) throw failure;
    return this.stored(row.id);
  }

  private async retireUnregisteredSchedule(row: JobRow, scheduleId: string, sessionId: string): Promise<void> {
    try {
      await this.runtime.cancel(this.env, { ...row, session_id: sessionId, schedule_id: scheduleId });
    } catch {
      try {
        await this.parkCancellation(row, scheduleId, sessionId);
      } catch (parkError) {
        throw new JobServiceError("Conflict", `schedule cancellation failed and could not be retained: ${parkError instanceof Error ? parkError.message : String(parkError)}`);
      }
    }
  }

  private async retirePersistedSchedule(row: JobRow, scheduleId: string, sessionId: string): Promise<boolean> {
    await this.parkCancellation(row, scheduleId, sessionId);
    const cancellation = await this.env.DB.prepare("SELECT id, job_id, owner_email, session_id, schedule_id, created_at FROM recurring_schedule_cancellations WHERE owner_email = ? AND session_id = ? AND schedule_id = ?")
      .bind(this.owner, sessionId, scheduleId).first<RecurringScheduleCancellation>();
    if (!cancellation) throw new JobServiceError("Conflict", "schedule cancellation could not be loaded");
    try {
      await this.runtime.cancel(this.env, { ...row, session_id: sessionId, schedule_id: scheduleId });
      await this.removeCancellation(cancellation);
      return true;
    } catch {
      return false;
    }
  }

  async list(status?: JobRow["status"]) {
    const rows = status
      ? await this.env.DB.prepare(`SELECT ${COLS} FROM jobs WHERE owner_email = ? AND status = ? ORDER BY updated_at DESC LIMIT 100`).bind(this.owner, status).all<JobRow>()
      : await this.env.DB.prepare(`SELECT ${COLS} FROM jobs WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 100`).bind(this.owner).all<JobRow>();
    return (rows.results ?? []).map(publicJob);
  }

  async history(id: string) {
    const rows = await this.env.DB.prepare("SELECT id, job_id, action, ok, detail_json, created_at FROM job_events WHERE job_id = ? AND owner_email = ? ORDER BY created_at DESC LIMIT 100").bind(id, this.owner).all<Evidence>();
    if (rows.results?.length) return rows.results.map(publicEvidence);
    await this.owned(id);
    return [];
  }

  async create(input: Partial<JobInput>, idempotencyKey?: string) {
    const parsed = validateJobInput(input);
    if ("tag" in parsed) throw new JobServiceError("InvalidInput", `${parsed.field}: ${parsed.message}`);
    if (idempotencyKey) {
      const prior = await this.env.DB.prepare(`SELECT ${COLS} FROM jobs WHERE owner_email = ? AND idempotency_key = ?`).bind(this.owner, idempotencyKey).first<JobRow>();
      if (prior) return publicJob(prior);
    }
    const session = await this.env.DB.prepare("SELECT id FROM sessions WHERE id = ? AND owner_email = ?").bind(parsed.sessionId, this.owner).first();
    if (!session) throw new JobServiceError("NotFound", "session not found or not owned");
    const count = await this.env.DB.prepare("SELECT count(*) count FROM jobs WHERE owner_email = ? AND status = 'active'").bind(this.owner).first<{ count: number }>();
    if ((count?.count ?? 0) >= MAX_ACTIVE_JOBS_PER_OWNER) throw new JobServiceError("QuotaExceeded", `Maximum active jobs is ${MAX_ACTIVE_JOBS_PER_OWNER}`);
    const id = crypto.randomUUID();
    const next = computeNextRun(this.now(), parsed.cadenceSecs);
    await this.env.DB.prepare("INSERT INTO jobs (id, owner_email, session_id, thread_mode, name, prompt, cadence_secs, status, next_run_at, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, datetime('now'), datetime('now'))")
      .bind(id, this.owner, parsed.sessionId, parsed.threadMode, parsed.name, parsed.prompt, parsed.cadenceSecs, next, idempotencyKey ?? null).run();
    const inserted = await this.stored(id);
    let scheduleId: string | null = null;
    let registered = false;
    try {
      scheduleId = await this.runtime.schedule(this.env, inserted);
      const registration = await this.env.DB.prepare("UPDATE jobs SET schedule_id = ?, state_version = state_version + 1 WHERE id = ? AND owner_email = ? AND status = 'active' AND schedule_id IS NULL AND state_version = 0")
        .bind(scheduleId, id, this.owner).run();
      if (registration.meta?.changes !== 1) throw new JobServiceError("Conflict", "job changed while registering its schedule");
      registered = true;
      await this.evidence(id, "create", true, { scheduled: true });
      return this.owned(id);
    } catch (error) {
      if (scheduleId && !registered) await this.retireUnregisteredSchedule(inserted, scheduleId, parsed.sessionId);
      throw error;
    }
  }

  async update(id: string, patch: Partial<JobInput>) {
    const old = await this.retryPendingCancellations(await this.stored(id));
    const switchingToSpecific = patch.threadMode === "specific_session" && old.thread_mode !== "specific_session";
    const mergedSessionId = switchingToSpecific ? (patch.sessionId ?? "") : (patch.sessionId ?? old.session_id);
    const parsed = validateJobInput({ sessionId: mergedSessionId, threadMode: patch.threadMode ?? old.thread_mode, name: patch.name ?? old.name, prompt: patch.prompt ?? old.prompt, cadenceSecs: patch.cadenceSecs ?? old.cadence_secs });
    if ("tag" in parsed) throw new JobServiceError("InvalidInput", `${parsed.field}: ${parsed.message}`);
    const session = await this.env.DB.prepare("SELECT id FROM sessions WHERE id = ? AND owner_email = ?").bind(parsed.sessionId, this.owner).first();
    if (!session) throw new JobServiceError("NotFound", "session not found or not owned");
    const replacement = old.status === "active"
      ? await this.runtime.schedule(this.env, { ...old, session_id: parsed.sessionId, thread_mode: parsed.threadMode, prompt: parsed.prompt, cadence_secs: parsed.cadenceSecs })
      : null;
    try {
      const next = old.status === "active" ? computeNextRun(this.now(), parsed.cadenceSecs) : old.next_run_at;
      const persisted = await this.env.DB.prepare("UPDATE jobs SET session_id=?, thread_mode=?, name=?, prompt=?, cadence_secs=?, next_run_at=?, schedule_id=?, updated_at=datetime('now'), state_version=state_version+1 WHERE id=? AND owner_email=? AND state_version=? AND status=? AND schedule_id IS ?")
        .bind(parsed.sessionId, parsed.threadMode, parsed.name, parsed.prompt, parsed.cadenceSecs, next, replacement, id, this.owner, old.state_version, old.status, old.schedule_id).run();
      if (persisted.meta?.changes !== 1) throw new JobServiceError("Conflict", "job changed while scheduling its replacement");
    } catch (error) {
      if (replacement) await this.retireUnregisteredSchedule(old, replacement, parsed.sessionId);
      throw error;
    }
    if (old.schedule_id) {
      const cancelled = await this.retirePersistedSchedule(old, old.schedule_id, old.session_id);
      if (!cancelled) {
        await this.env.DB.prepare("UPDATE jobs SET last_error = ? WHERE id = ? AND owner_email = ? AND schedule_id = ?")
          .bind("schedule cancellation pending", id, this.owner, replacement).run().catch(() => undefined);
      }
    }
    await this.evidence(id, "update", true, { replacementScheduled: replacement !== null, oldScheduleCancellationPending: old.schedule_id !== null });
    return this.owned(id);
  }

  async setPaused(id: string, paused: boolean) {
    const row = await this.retryPendingCancellations(await this.stored(id));
    if ((paused && row.status === "paused") || (!paused && row.status === "active")) return publicJob(row);
    if (!paused) {
      const count = await this.env.DB.prepare("SELECT count(*) count FROM jobs WHERE owner_email=? AND status='active'").bind(this.owner).first<{ count: number }>();
      if ((count?.count ?? 0) >= MAX_ACTIVE_JOBS_PER_OWNER) throw new JobServiceError("QuotaExceeded", `Maximum active jobs is ${MAX_ACTIVE_JOBS_PER_OWNER}`);
      const scheduleId = await this.runtime.schedule(this.env, row);
      try {
        const resumed = await this.env.DB.prepare("UPDATE jobs SET status='active', schedule_id=?, next_run_at=?, updated_at=datetime('now'), state_version=state_version+1 WHERE id=? AND owner_email=? AND state_version=? AND status='paused' AND schedule_id IS NULL")
          .bind(scheduleId, computeNextRun(this.now(), row.cadence_secs), id, this.owner, row.state_version).run();
        if (resumed.meta?.changes !== 1) throw new JobServiceError("Conflict", "job changed while resuming");
      } catch (error) {
        await this.retireUnregisteredSchedule(row, scheduleId, row.session_id);
        throw error;
      }
    } else {
      if (row.schedule_id) await this.runtime.cancel(this.env, row);
      const pausedResult = await this.env.DB.prepare("UPDATE jobs SET status='paused', schedule_id=NULL, updated_at=datetime('now'), state_version=state_version+1 WHERE id=? AND owner_email=? AND state_version=? AND status='active' AND schedule_id IS ?")
        .bind(id, this.owner, row.state_version, row.schedule_id).run();
      if (pausedResult.meta?.changes !== 1) throw new JobServiceError("Conflict", "job changed while pausing");
    }
    await this.evidence(id, paused ? "pause" : "resume", true, {});
    return this.owned(id);
  }

  async run(id: string, idempotencyKey?: string) {
    const row = await this.owned(id);
    const now = this.now();
    let eventId: string = crypto.randomUUID();
    if (idempotencyKey) {
      const prior = await this.env.DB.prepare("SELECT id, ok, detail_json FROM job_events WHERE job_id=? AND owner_email=? AND action='run' AND idempotency_key=?").bind(id, this.owner, idempotencyKey).first<{ id: string; ok: number; detail_json: string }>();
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
    const row = await this.retryPendingCancellations(await this.stored(id));
    if (row.schedule_id) await this.runtime.cancel(this.env, row);
    await this.evidence(id, "delete", true, { snapshot: { name: row.name, sessionId: row.session_id, threadMode: row.thread_mode } });
    const deleted = await this.env.DB.prepare("DELETE FROM jobs WHERE id=? AND owner_email=? AND state_version=? AND status=? AND schedule_id IS ?")
      .bind(id, this.owner, row.state_version, row.status, row.schedule_id).run();
    if (deleted.meta?.changes !== 1) throw new JobServiceError("Conflict", "job changed while deleting");
    return { deleted: id };
  }
}
