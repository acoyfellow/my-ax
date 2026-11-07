export type JobStatus = "active" | "paused" | "exhausted";

export type JobStatusEvent = "paused" | "resumed" | "run_claimed" | "edited";

export function nextJobStatus(current: JobStatus, event: JobStatusEvent, context: { exhaustedAfter: boolean } = { exhaustedAfter: false }): JobStatus | null {
  if (current === "exhausted") return event === "edited" && context.exhaustedAfter ? "exhausted" : null;
  if (event === "paused") return current === "active" ? "paused" : null;
  if (event === "resumed") return current === "paused" ? "active" : null;
  if (event === "run_claimed") return current === "active" ? (context.exhaustedAfter ? "exhausted" : "active") : null;
  return context.exhaustedAfter ? "exhausted" : current;
}

export interface JobStatusDb {
  prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown> } };
}

export interface JobRef {
  id: string;
  ownerEmail: string;
}

function changed(result: unknown): boolean {
  const changes = (result as { meta?: { changes?: unknown } } | null)?.meta?.changes;
  return typeof changes === "number" && changes > 0;
}

export async function markJobResumed(db: JobStatusDb, job: JobRef, scheduleId: string, nextRunAt: string): Promise<boolean> {
  return changed(await db.prepare("UPDATE jobs SET status='active', schedule_id=?, next_run_at=?, updated_at=datetime('now') WHERE id=? AND owner_email=? AND status='paused'")
    .bind(scheduleId, nextRunAt, job.id, job.ownerEmail).run());
}

export async function markJobPaused(db: JobStatusDb, job: JobRef): Promise<boolean> {
  return changed(await db.prepare("UPDATE jobs SET status='paused', schedule_id=NULL, updated_at=datetime('now') WHERE id=? AND owner_email=? AND status='active'")
    .bind(job.id, job.ownerEmail).run());
}

export interface JobEdit {
  sessionId: string;
  threadMode: string;
  name: string;
  prompt: string;
  cadenceSecs: number;
  maxRuns: number | null;
  status: JobStatus;
  nextRunAt: string | null;
  scheduleId: string | null;
}

export async function saveJobEdit(db: JobStatusDb, job: JobRef, from: JobStatus, edit: JobEdit): Promise<boolean> {
  if (from === "exhausted" && edit.status !== "exhausted") throw new Error("an exhausted job cannot be edited back to life");
  return changed(await db.prepare("UPDATE jobs SET session_id=?, thread_mode=?, name=?, prompt=?, cadence_secs=?, max_runs=?, status=?, next_run_at=?, schedule_id=?, updated_at=datetime('now') WHERE id=? AND owner_email=? AND status=?")
    .bind(edit.sessionId, edit.threadMode, edit.name, edit.prompt, edit.cadenceSecs, edit.maxRuns, edit.status, edit.nextRunAt, edit.scheduleId, job.id, job.ownerEmail, from).run());
}

export const CLAIM_RUN_SQL = `UPDATE jobs
    SET run_count = run_count + 1,
        status = CASE WHEN max_runs IS NOT NULL AND run_count + 1 >= max_runs THEN 'exhausted' ELSE 'active' END,
        schedule_id = CASE WHEN max_runs IS NOT NULL AND run_count + 1 >= max_runs THEN NULL ELSE schedule_id END,
        updated_at = datetime('now')
    WHERE id = ?
      AND owner_email = ?
      AND status = 'active'
      AND (max_runs IS NULL OR run_count < max_runs)
    RETURNING max_runs, run_count, status`;

export function pausedJob<T extends { status: JobStatus; schedule_id: string | null }>(row: T): T {
  return { ...row, status: "paused", schedule_id: null };
}

export function activeJob<T extends { status: JobStatus; schedule_id: string | null }>(row: T, scheduleId: string): T {
  return { ...row, status: "active", schedule_id: scheduleId };
}
