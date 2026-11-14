import { EDIT_JOB_SQL, type JobStoreDb, jobWrite, PAUSE_JOB_SQL, RESUME_JOB_SQL } from "../domain/Job/Job.store";
import { safely, shadowJob } from "../domain/shadow";
import { shadowReadStatus } from "../domain/shadow-read";
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
  prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown>; first?<T>(): Promise<T | null> } };
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
  const from = await shadowReadStatus(db, "jobs", job.id, job.ownerEmail);
  const applied = changed(await jobWrite(db as JobStoreDb, job.id, job.ownerEmail, { kind: "resume" }, RESUME_JOB_SQL, [scheduleId, nextRunAt, job.id, job.ownerEmail]));
  if (from !== undefined) safely(() => shadowJob("resumed", job.ownerEmail, from, applied ? "accepted" : "rejected"));
  return applied;
}

export async function markJobPaused(db: JobStatusDb, job: JobRef): Promise<boolean> {
  const from = await shadowReadStatus(db, "jobs", job.id, job.ownerEmail);
  const applied = changed(await jobWrite(db as JobStoreDb, job.id, job.ownerEmail, { kind: "pause" }, PAUSE_JOB_SQL, [job.id, job.ownerEmail]));
  if (from !== undefined) safely(() => shadowJob("paused", job.ownerEmail, from, applied ? "accepted" : "rejected"));
  return applied;
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
  return changed(await jobWrite(db as JobStoreDb, job.id, job.ownerEmail, { kind: "edit", name: edit.name, prompt: edit.prompt, cadenceSecs: edit.cadenceSecs, maxRuns: edit.maxRuns }, EDIT_JOB_SQL, [edit.sessionId, edit.threadMode, edit.name, edit.prompt, edit.cadenceSecs, edit.maxRuns, edit.status, edit.nextRunAt, edit.scheduleId, job.id, job.ownerEmail, from]));
}

export { CLAIM_RUN_SQL } from "../domain/Job/Job.store";

export function pausedJob<T extends { status: JobStatus; schedule_id: string | null }>(row: T): T {
  return { ...row, status: "paused", schedule_id: null };
}

export function activeJob<T extends { status: JobStatus; schedule_id: string | null }>(row: T, scheduleId: string): T {
  return { ...row, status: "active", schedule_id: scheduleId };
}
