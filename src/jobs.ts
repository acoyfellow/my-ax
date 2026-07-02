// Recurring prompt job helpers.
//
// Native agents `scheduleEvery()` alarms own recurrence inside each session
// DO. D1 is a thin owner/session UI index (name, prompt, cadence, schedule_id,
// run receipts). Manual Run now reuses the same `/inject-user-message` path.

import type { Env } from "./types";
import { completeRecurringJobRun } from "./recurring-job-run";

async function sessionAgent(env: Env, ownerEmail: string, sessionId: string) {
  // Keep the Cloudflare-only agent stub out of module initialization so pure
  // validation/service tests can run under Node.
  const { getSessionAgent } = await import("./agent-stub");
  return getSessionAgent(env, ownerEmail, sessionId);
}

function recurringRunSessionTitle(row: Pick<JobRow, "name">, now: Date): string {
  const stamp = now.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });
  return `${row.name} · ${stamp}`.slice(0, MAX_NAME_CHARS);
}

export async function resolveRecurringJobTargetSession(env: Env, row: Pick<JobRow, "id" | "owner_email" | "session_id" | "thread_mode" | "name">, now: Date): Promise<{ targetSessionId: string; sourceSessionId: string; threadMode: RecurringJobThreadMode; created: boolean }> {
  if (row.thread_mode === "same_session") return { targetSessionId: row.session_id, sourceSessionId: row.session_id, threadMode: row.thread_mode, created: false };
  const targetSessionId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO sessions (id, name, status, owner_email, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, ?)")
    .bind(targetSessionId, recurringRunSessionTitle(row, now), row.owner_email, now.toISOString(), now.toISOString()).run();
  return { targetSessionId, sourceSessionId: row.session_id, threadMode: row.thread_mode, created: true };
}

export const MIN_CADENCE_SECS = 60;
export const MAX_CADENCE_SECS = 60 * 60 * 24 * 30; // 30 days
export const MAX_PROMPT_CHARS = 4000;
export const MAX_NAME_CHARS = 200;
export const MAX_ACTIVE_JOBS_PER_OWNER = 10;

export type JobStatus = "active" | "paused";
export type RecurringJobThreadMode = "same_session" | "new_session_per_run";
export const RECURRING_JOB_THREAD_MODES: readonly RecurringJobThreadMode[] = ["same_session", "new_session_per_run"];

export interface JobRow {
  id: string;
  owner_email: string;
  session_id: string;
  thread_mode: RecurringJobThreadMode;
  name: string;
  prompt: string;
  cadence_secs: number;
  status: JobStatus;
  next_run_at: string;
  last_run_at: string | null;
  last_error: string | null;
  schedule_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobInput {
  sessionId: string;
  name: string;
  prompt: string;
  cadenceSecs: number;
  threadMode: RecurringJobThreadMode;
}

export type ValidationError = { tag: "InvalidInput"; field: string; message: string };

/** Pure: compute next UTC ISO run boundary from a base instant + cadence. */
export function computeNextRun(base: Date, cadenceSecs: number): string {
  return new Date(base.getTime() + cadenceSecs * 1000).toISOString();
}

/** Validate + normalize JobInput. Returns a tagged error if invalid. */
export function validateJobInput(input: Partial<JobInput>): ValidationError | JobInput {
  const sessionId = (input.sessionId ?? "").trim();
  if (!sessionId) return { tag: "InvalidInput", field: "sessionId", message: "required" };
  const name = (input.name ?? "").trim();
  if (!name) return { tag: "InvalidInput", field: "name", message: "required" };
  const prompt = (input.prompt ?? "").trim();
  if (!prompt) return { tag: "InvalidInput", field: "prompt", message: "required" };
  if (prompt.length > MAX_PROMPT_CHARS) return { tag: "InvalidInput", field: "prompt", message: `> ${MAX_PROMPT_CHARS} chars` };
  const cadenceSecs = Number(input.cadenceSecs);
  if (!Number.isInteger(cadenceSecs)) return { tag: "InvalidInput", field: "cadenceSecs", message: "must be an integer" };
  if (cadenceSecs < MIN_CADENCE_SECS || cadenceSecs > MAX_CADENCE_SECS) {
    return { tag: "InvalidInput", field: "cadenceSecs", message: `must be in [${MIN_CADENCE_SECS}, ${MAX_CADENCE_SECS}]` };
  }
  const rawThreadMode = typeof (input as Partial<JobInput>).threadMode === "string" ? (input as Partial<JobInput>).threadMode : "new_session_per_run";
  const threadMode = RECURRING_JOB_THREAD_MODES.includes(rawThreadMode as RecurringJobThreadMode) ? rawThreadMode as RecurringJobThreadMode : null;
  if (!threadMode) return { tag: "InvalidInput", field: "threadMode", message: "must be same_session or new_session_per_run" };
  return { sessionId, name: name.slice(0, MAX_NAME_CHARS), prompt: prompt.slice(0, MAX_PROMPT_CHARS), cadenceSecs, threadMode };
}

/**
 * Fire a single job. Reuses the agent DO's internal inject path so a
 * job-fired prompt is shaped identically to an owner-initiated one.
 * Ownership is the caller's responsibility — REST routes verify the
 * owner_email match before calling.
 */
export const SCHEDULED_JOB_RUN_PREFIX = "You are executing one scheduled run of an existing recurring job. Do not create, update, resume, pause, delete, or schedule recurring jobs from this run unless the owner explicitly asked this run to modify job configuration. Do the requested check/work once, leave truthful receipts/notifications required by the prompt, then stop.";

export function scheduledJobRunPrompt(prompt: string): string {
  return `${SCHEDULED_JOB_RUN_PREFIX}\n\n${prompt}`;
}

export async function runJobNow(env: Env, row: JobRow, now: Date = new Date()): Promise<{ next_run_at: string; ok: boolean; error?: string; target_session_id: string; thread_mode: RecurringJobThreadMode }> {
  let ok = true;
  let error: string | undefined;
  const target = await resolveRecurringJobTargetSession(env, row, now);
  try {
    const stub = await sessionAgent(env, row.owner_email, target.targetSessionId);
    // Scheduled work has no browser connection to seed Access identity.
    await stub.seedIdentity({ email: row.owner_email, sub: `job:${row.owner_email}` });
    await stub.injectUserMessage({ content: scheduledJobRunPrompt(row.prompt), clientMsgId: `job:${row.id}:${now.getTime()}` });
  } catch (e) {
    ok = false;
    error = e instanceof Error ? e.message : String(e);
  }
  const nextRunAt = computeNextRun(now, row.cadence_secs);
  if (ok) {
    await env.DB.prepare(
      "UPDATE jobs SET next_run_at = ?, last_run_at = ?, last_error = NULL, updated_at = datetime('now') WHERE id = ? AND owner_email = ?",
    ).bind(nextRunAt, now.toISOString(), row.id, row.owner_email.toLowerCase()).run().catch(() => undefined);
  } else {
    await completeRecurringJobRun(env, {
      jobId: row.id,
      ownerEmail: row.owner_email,
      sessionId: target.targetSessionId,
      sourceSessionId: target.sourceSessionId,
      threadMode: target.threadMode,
      ranAt: now,
      nextRunAt,
      jobName: row.name,
      error,
    });
  }
  return { next_run_at: nextRunAt, ok, error, target_session_id: target.targetSessionId, thread_mode: target.threadMode };
}

/** Register a native agents scheduleEvery alarm on the target session DO. */
export function requireScheduleId(schedule: { id?: string } | null | undefined): string {
  if (!schedule?.id) throw new Error("recurring job schedule did not return an id");
  return schedule.id;
}

export async function scheduleJob(env: Env, row: Pick<JobRow, "id" | "owner_email" | "session_id" | "thread_mode" | "prompt" | "cadence_secs">): Promise<string> {
  const stub = await sessionAgent(env, row.owner_email, row.session_id);
  await stub.seedIdentity({ email: row.owner_email, sub: `job:${row.owner_email}` });
  return requireScheduleId(await stub.scheduleRecurringPrompt({ jobId: row.id, ownerEmail: row.owner_email, prompt: row.prompt, cadenceSecs: row.cadence_secs }));
}

/** Cancel a native agents alarm if one is registered. */
export async function cancelJobSchedule(env: Env, row: Pick<JobRow, "owner_email" | "session_id" | "schedule_id">): Promise<void> {
  if (!row.schedule_id) return;
  const stub = await sessionAgent(env, row.owner_email, row.session_id);
  await stub.cancelRecurringPrompt(row.schedule_id);
}
