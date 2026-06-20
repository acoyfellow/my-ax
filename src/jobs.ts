// Recurring prompt job helpers.
//
// Native agents `scheduleEvery()` alarms own recurrence inside each session
// DO. D1 is a thin owner/session UI index (name, prompt, cadence, schedule_id,
// run receipts). Manual Run now reuses the same `/inject-user-message` path.

import type { Env } from "./types";

async function sessionAgent(env: Env, ownerEmail: string, sessionId: string) {
  // Keep the Cloudflare-only agent stub out of module initialization so pure
  // validation/service tests can run under Node.
  const { getSessionAgent } = await import("./agent-stub");
  return getSessionAgent(env, ownerEmail, sessionId);
}

export const MIN_CADENCE_SECS = 60;
export const MAX_CADENCE_SECS = 60 * 60 * 24 * 30; // 30 days
export const MAX_PROMPT_CHARS = 4000;
export const MAX_NAME_CHARS = 200;
export const MAX_ACTIVE_JOBS_PER_OWNER = 10;

export type JobStatus = "active" | "paused";

export interface JobRow {
  id: string;
  owner_email: string;
  session_id: string;
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
  return { sessionId, name: name.slice(0, MAX_NAME_CHARS), prompt: prompt.slice(0, MAX_PROMPT_CHARS), cadenceSecs };
}

/**
 * Fire a single job. Reuses the agent DO's internal inject path so a
 * job-fired prompt is shaped identically to an owner-initiated one.
 * Ownership is the caller's responsibility — REST routes verify the
 * owner_email match before calling.
 */
export async function runJobNow(env: Env, row: JobRow, now: Date = new Date()): Promise<{ next_run_at: string; ok: boolean; error?: string }> {
  let ok = true;
  let error: string | undefined;
  try {
    const stub = await sessionAgent(env, row.owner_email, row.session_id);
    // Scheduled work has no browser connection to seed Access identity.
    await stub.seedIdentity({ email: row.owner_email, sub: `job:${row.owner_email}` });
    await stub.injectUserMessage({ content: row.prompt, clientMsgId: `job:${row.id}:${now.getTime()}` });
  } catch (e) {
    ok = false;
    error = e instanceof Error ? e.message : String(e);
  }
  const nextRunAt = computeNextRun(now, row.cadence_secs);
  try {
    await env.DB.prepare(
      "UPDATE jobs SET next_run_at = ?, last_run_at = ?, last_error = ?, updated_at = datetime('now') WHERE id = ? AND owner_email = ?",
    ).bind(nextRunAt, now.toISOString(), ok ? null : (error ?? "unknown").slice(0, 500), row.id, row.owner_email).run();
  } catch { /* dev D1 missing — tolerate */ }
  return { next_run_at: nextRunAt, ok, error };
}

/** Register a native agents scheduleEvery alarm on the target session DO. */
export async function scheduleJob(env: Env, row: Pick<JobRow, "id" | "owner_email" | "session_id" | "prompt" | "cadence_secs">): Promise<string> {
  const stub = await sessionAgent(env, row.owner_email, row.session_id);
  await stub.seedIdentity({ email: row.owner_email, sub: `job:${row.owner_email}` });
  const schedule = await stub.scheduleRecurringPrompt({ jobId: row.id, ownerEmail: row.owner_email, prompt: row.prompt, cadenceSecs: row.cadence_secs });
  return schedule.id;
}

/** Cancel a native agents alarm if one is registered. */
export async function cancelJobSchedule(env: Env, row: Pick<JobRow, "owner_email" | "session_id" | "schedule_id">): Promise<void> {
  if (!row.schedule_id) return;
  const stub = await sessionAgent(env, row.owner_email, row.session_id);
  await stub.cancelRecurringPrompt(row.schedule_id);
}
