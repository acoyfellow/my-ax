import { decide, DomainRejected } from "../decide";
import { ClaimRun } from "./ClaimRun.command";
import { CreateJob } from "./CreateJob.command";
import { DeleteJob } from "./DeleteJob.command";
import { EditJob } from "./EditJob.command";
import { Job, type JobState } from "./Job.aggregate";
import { PauseJob } from "./PauseJob.command";
import { RecordJobBookkeeping } from "./RecordJobBookkeeping.command";
import { ResumeJob } from "./ResumeJob.command";

export const RESUME_JOB_SQL = "UPDATE jobs SET status='active', schedule_id=?, next_run_at=?, updated_at=datetime('now') WHERE id=? AND owner_email=? AND status='paused'";
export const PAUSE_JOB_SQL = "UPDATE jobs SET status='paused', schedule_id=NULL, updated_at=datetime('now') WHERE id=? AND owner_email=? AND status='active'";
export const EDIT_JOB_SQL = "UPDATE jobs SET session_id=?, thread_mode=?, name=?, prompt=?, cadence_secs=?, max_runs=?, status=?, next_run_at=?, schedule_id=?, updated_at=datetime('now') WHERE id=? AND owner_email=? AND status=?";
export const INSERT_JOB_SQL = "INSERT INTO jobs (id, owner_email, session_id, thread_mode, name, prompt, cadence_secs, max_runs, run_count, status, next_run_at, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, ?, datetime('now'), datetime('now'))";
export const SET_JOB_SCHEDULE_SQL = "UPDATE jobs SET schedule_id = ? WHERE id = ? AND owner_email = ?";
export const SET_JOB_SCHEDULE_COMPACT_SQL = "UPDATE jobs SET schedule_id=? WHERE id=? AND owner_email=?";
export const DELETE_JOB_SQL = "DELETE FROM jobs WHERE id = ? AND owner_email = ?";
export const DELETE_JOB_COMPACT_SQL = "DELETE FROM jobs WHERE id=? AND owner_email=?";
export const SET_JOB_ERROR_SQL = "UPDATE jobs SET last_error=? WHERE id=? AND owner_email=?";
export const JOB_RAN_NEXT_SQL = "UPDATE jobs SET next_run_at = ?, last_run_at = ?, last_error = NULL, updated_at = datetime('now') WHERE id = ? AND owner_email = ?";
export const JOB_RAN_LAST_SQL = "UPDATE jobs SET last_run_at = ?, last_error = NULL, updated_at = datetime('now') WHERE id = ? AND owner_email = ?";
export const JOB_FINISHED_NEXT_SQL = "UPDATE jobs SET next_run_at = ?, last_run_at = ?, last_error = ?, updated_at = datetime('now') WHERE id = ? AND owner_email = ?";
export const JOB_FINISHED_LAST_SQL = "UPDATE jobs SET last_run_at = ?, last_error = ?, updated_at = datetime('now') WHERE id = ? AND owner_email = ?";
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

type Statement = { run(): Promise<unknown>; first?<T>(): Promise<T | null>; all?<T>(): Promise<{ results?: T[] }> };
export type JobStoreDb = { prepare(sql: string): { bind(...values: unknown[]): Statement } };

type JobRow = { status: "active" | "paused" | "exhausted"; name: string; prompt: string; cadence_secs: number; max_runs: number | null; run_count: number };

const TAG = { active: "Active", paused: "Paused", exhausted: "Exhausted" } as const;

export function jobStateOf(ownerEmail: string, row: JobRow | null): JobState {
  if (!row) return { _tag: "Unscheduled" };
  return { _tag: TAG[row.status], ownerEmail, name: row.name ?? "", prompt: row.prompt ?? "", cadenceSecs: Number(row.cadence_secs ?? 60), maxRuns: row.max_runs ?? null, runCount: Number(row.run_count ?? 0) };
}

async function loadJob(db: JobStoreDb, id: string, ownerEmail: string): Promise<JobState | undefined> {
  const statement = db.prepare("SELECT * FROM jobs WHERE id = ? AND owner_email = ?").bind(id, ownerEmail);
  if (!statement.first) return undefined;
  return jobStateOf(ownerEmail, await statement.first<JobRow>());
}

export type JobCommand =
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "claim" }
  | { kind: "bookkeeping" }
  | { kind: "delete" }
  | { kind: "edit"; name: string; prompt: string; cadenceSecs: number; maxRuns: number | null };

function commandFor(command: JobCommand) {
  switch (command.kind) {
    case "pause": return new PauseJob();
    case "resume": return new ResumeJob();
    case "claim": return new ClaimRun();
    case "bookkeeping": return new RecordJobBookkeeping();
    case "delete": return new DeleteJob();
    case "edit": return new EditJob({ name: command.name, prompt: command.prompt, cadenceSecs: command.cadenceSecs, maxRuns: command.maxRuns });
  }
}

export async function decideJob(db: JobStoreDb, id: string, ownerEmail: string, command: JobCommand): Promise<boolean> {
  const state = await loadJob(db, id, ownerEmail);
  if (state === undefined) return true;
  try {
    decide(Job, id, state, commandFor(command));
    return true;
  } catch (error) {
    if (error instanceof DomainRejected) return false;
    throw error;
  }
}

export type WriteResult = { meta?: { changes?: number } };

export async function jobWrite(db: JobStoreDb, id: string, ownerEmail: string, command: JobCommand, sql: string, binds: readonly unknown[]): Promise<WriteResult> {
  if (!(await decideJob(db, id, ownerEmail, command))) return { meta: { changes: 0 } };
  return (await db.prepare(sql).bind(...binds).run()) as WriteResult;
}

export type ClaimedRun = { max_runs: number | null; run_count: number; status: "active" | "paused" | "exhausted" };

export async function claimJobRun(db: JobStoreDb, id: string, ownerEmail: string): Promise<ClaimedRun | null> {
  if (!(await decideJob(db, id, ownerEmail, { kind: "claim" }))) return null;
  const statement = db.prepare(CLAIM_RUN_SQL).bind(id, ownerEmail);
  return statement.first ? statement.first<ClaimedRun>() : null;
}

export type NewJob = { id: string; ownerEmail: string; name: string; prompt: string; cadenceSecs: number; maxRuns: number | null };

export async function createJobRecord(db: JobStoreDb, job: NewJob, sql: string, binds: readonly unknown[]): Promise<void> {
  decide(Job, job.id, { _tag: "Unscheduled" }, new CreateJob({ ownerEmail: job.ownerEmail, name: job.name, prompt: job.prompt, cadenceSecs: job.cadenceSecs, maxRuns: job.maxRuns }));
  await db.prepare(sql).bind(...binds).run();
}

export async function deleteSessionJobs(db: JobStoreDb, sessionId: string, ownerEmail: string): Promise<void> {
  const statement = db.prepare("SELECT * FROM jobs WHERE session_id = ? AND owner_email = ?").bind(sessionId, ownerEmail);
  const rows = statement.all ? ((await statement.all<JobRow & { id: string }>()).results ?? []) : [];
  for (const row of rows) decide(Job, row.id, jobStateOf(ownerEmail, row), new DeleteJob());
  await db.prepare("DELETE FROM jobs WHERE session_id = ? AND owner_email = ?").bind(sessionId, ownerEmail).run();
}
