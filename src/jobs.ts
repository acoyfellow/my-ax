import type { Env } from "./types";
import { completeRecurringJobRun } from "./recurring-job-run";

async function sessionAgent(env: Env, ownerEmail: string, sessionId: string) {
  const { getSessionAgent } = await import("./agent-stub");
  return getSessionAgent(env, ownerEmail, sessionId);
}

function recurringRunSessionTitle(row: Pick<JobRow, "name">, now: Date): string {
  const stamp = now.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });
  return `${row.name} · ${stamp}`.slice(0, MAX_NAME_CHARS);
}

export async function resolveRecurringJobTargetSession(env: Env, row: Pick<JobRow, "id" | "owner_email" | "session_id" | "thread_mode" | "name">, now: Date, requestedTargetSessionId?: string): Promise<{ targetSessionId: string; sourceSessionId: string; threadMode: RecurringJobThreadMode; created: boolean }> {
  if (row.thread_mode === "same_session" || row.thread_mode === "specific_session") return { targetSessionId: row.session_id, sourceSessionId: row.session_id, threadMode: row.thread_mode, created: false };
  if (row.thread_mode !== "new_session_per_run") throw new Error(`invalid recurring job thread mode: ${row.thread_mode}`);
  const targetSessionId = requestedTargetSessionId ?? crypto.randomUUID();
  const result = await env.DB.prepare("INSERT OR IGNORE INTO sessions (id, name, status, owner_email, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, ?)")
    .bind(targetSessionId, recurringRunSessionTitle(row, now), row.owner_email, now.toISOString(), now.toISOString()).run();
  return { targetSessionId, sourceSessionId: row.session_id, threadMode: row.thread_mode, created: result.meta?.changes !== 0 };
}

export const MIN_CADENCE_SECS = 60;
export const MAX_CADENCE_SECS = 60 * 60 * 24 * 30;
export const MAX_PROMPT_CHARS = 4000;
export const MAX_NAME_CHARS = 200;
export const MAX_ACTIVE_JOBS_PER_OWNER = 10;

export type JobStatus = "active" | "paused";
export type RecurringJobThreadMode = "same_session" | "new_session_per_run" | "specific_session";
export const RECURRING_JOB_THREAD_MODES: readonly RecurringJobThreadMode[] = ["same_session", "new_session_per_run", "specific_session"];

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
  state_version: number;
}

export interface RecurringJobState extends JobRow {
  recurring_fire_key: string | null;
  recurring_fire_verifier_hash: string | null;
  recurring_fire_state: string | null;
  recurring_fire_scheduled_at: string | null;
  recurring_submission_id: string | null;
  recurring_fire_target_session_id: string | null;
  recurring_receipt_id: string | null;
}

export interface RecurringScheduleCancellation {
  id: string;
  job_id: string;
  owner_email: string;
  session_id: string;
  schedule_id: string;
  created_at: string;
}

export interface JobInput {
  sessionId: string;
  name: string;
  prompt: string;
  cadenceSecs: number;
  threadMode: RecurringJobThreadMode;
}

export interface RecurringSchedulePayload {
  version: 1;
  jobId: string;
  ownerEmail: string;
  sessionId: string;
  prompt: string;
  generation: string;
}

export interface LegacyRecurringSchedulePayload {
  jobId: string;
  ownerEmail: string;
  prompt: string;
}

export interface RecurringScheduleIdentity {
  nativeScheduleId: string;
  generation: string;
}

export interface RecurringScheduleFence {
  jobId: string;
  ownerEmail: string;
  sessionId: string;
  scheduleId: string;
  generation: string;
}

export interface RecurringScheduleDispatchClaim extends RecurringScheduleFence {
  scheduledAt: string;
  fireKey: string;
  verifierHash: string;
  submissionId: string;
  targetSessionId: string;
  receiptId: string;
}

export interface NativeRecurringSchedule {
  id: string;
  callback: string;
  payload: unknown;
  type: "scheduled" | "delayed" | "cron" | "interval";
  intervalSeconds?: number;
}

export type RecurringScheduleValidation =
  | { ok: true }
  | { ok: false; reason: "invalid_payload" | "missing_job" | "inactive_job" | "wrong_owner" | "wrong_session" | "invalid_job" | "legacy_schedule_identity" | "generation_mismatch" | "schedule_list_failed" | "schedule_missing" | "schedule_mismatch" };

export type ValidationError = { tag: "InvalidInput"; field: string; message: string };

const RECURRING_SCHEDULE_ID_PREFIX = "recurring-v1:";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function matchingJobPayload(row: Pick<JobRow, "id" | "owner_email" | "session_id" | "prompt">, payload: RecurringSchedulePayload): boolean {
  return payload.jobId === row.id
    && payload.ownerEmail === row.owner_email.toLowerCase()
    && payload.sessionId === row.session_id
    && payload.prompt === row.prompt;
}

export function isRecurringSchedulePayload(value: unknown): value is RecurringSchedulePayload {
  const payload = record(value);
  return payload?.version === 1
    && typeof payload.jobId === "string" && payload.jobId.length > 0
    && typeof payload.ownerEmail === "string" && payload.ownerEmail.length > 0
    && typeof payload.sessionId === "string" && payload.sessionId.length > 0
    && typeof payload.prompt === "string"
    && typeof payload.generation === "string" && payload.generation.length > 0;
}

export function isLegacyRecurringSchedulePayload(value: unknown): value is LegacyRecurringSchedulePayload {
  const payload = record(value);
  return payload?.version === undefined
    && typeof payload?.jobId === "string" && payload.jobId.length > 0
    && typeof payload?.ownerEmail === "string" && payload.ownerEmail.length > 0
    && typeof payload?.prompt === "string";
}

export function recurringScheduleIdentity(nativeScheduleId: string, generation: string): string {
  return `${RECURRING_SCHEDULE_ID_PREFIX}${JSON.stringify({ nativeScheduleId, generation })}`;
}

export function parseRecurringScheduleIdentity(value: string | null | undefined): RecurringScheduleIdentity | null {
  if (!value?.startsWith(RECURRING_SCHEDULE_ID_PREFIX)) return null;
  try {
    const identity = record(JSON.parse(value.slice(RECURRING_SCHEDULE_ID_PREFIX.length)));
    if (typeof identity?.nativeScheduleId !== "string" || !identity.nativeScheduleId || typeof identity.generation !== "string" || !identity.generation) return null;
    return { nativeScheduleId: identity.nativeScheduleId, generation: identity.generation };
  } catch {
    return null;
  }
}

export function nativeScheduleId(value: string | null | undefined): string | null {
  if (!value) return null;
  return parseRecurringScheduleIdentity(value)?.nativeScheduleId ?? value;
}

function sameRecurringSchedulePayload(left: RecurringSchedulePayload, right: unknown): boolean {
  return isRecurringSchedulePayload(right)
    && left.version === right.version
    && left.jobId === right.jobId
    && left.ownerEmail === right.ownerEmail
    && left.sessionId === right.sessionId
    && left.prompt === right.prompt
    && left.generation === right.generation;
}

export function isNativeRecurringSchedule(value: unknown): value is NativeRecurringSchedule {
  const schedule = record(value);
  return typeof schedule?.id === "string" && schedule.id.length > 0
    && typeof schedule.callback === "string"
    && (schedule.type === "scheduled" || schedule.type === "delayed" || schedule.type === "cron" || schedule.type === "interval")
    && (schedule.intervalSeconds === undefined || typeof schedule.intervalSeconds === "number");
}

function matchingNativeInterval(schedule: NativeRecurringSchedule, row: Pick<JobRow, "cadence_secs">): boolean {
  return schedule.callback === "runRecurringPrompt" && schedule.type === "interval" && schedule.intervalSeconds === row.cadence_secs;
}

export function currentRecurringSchedulePayload(row: Pick<JobRow, "id" | "owner_email" | "session_id" | "prompt">, generation: string): RecurringSchedulePayload {
  return { version: 1, jobId: row.id, ownerEmail: row.owner_email.toLowerCase(), sessionId: row.session_id, prompt: row.prompt, generation };
}

export function findVersionedRecurringSchedule(schedules: unknown, row: Pick<JobRow, "id" | "owner_email" | "session_id" | "prompt" | "cadence_secs">): { schedule: NativeRecurringSchedule; payload: RecurringSchedulePayload } | null {
  if (!Array.isArray(schedules) || schedules.length > 100 || !schedules.every(isNativeRecurringSchedule)) return null;
  for (const schedule of schedules) {
    if (!matchingNativeInterval(schedule, row) || !isRecurringSchedulePayload(schedule.payload) || !matchingJobPayload(row, schedule.payload)) continue;
    return { schedule, payload: schedule.payload };
  }
  return null;
}

export function isAuthoritativeLegacyRecurringSchedule(schedule: unknown, row: Pick<JobRow, "id" | "owner_email" | "prompt" | "cadence_secs" | "schedule_id">, payload: LegacyRecurringSchedulePayload): schedule is NativeRecurringSchedule {
  if (!isNativeRecurringSchedule(schedule) || schedule.id !== row.schedule_id || !matchingNativeInterval(schedule, row)) return false;
  return payload.jobId === row.id
    && payload.ownerEmail === row.owner_email.toLowerCase()
    && payload.prompt === row.prompt
    && schedule.payload !== null
    && typeof schedule.payload === "object"
    && !isRecurringSchedulePayload(schedule.payload)
    && isLegacyRecurringSchedulePayload(schedule.payload)
    && schedule.payload.jobId === payload.jobId
    && schedule.payload.ownerEmail === payload.ownerEmail
    && schedule.payload.prompt === payload.prompt;
}

export async function validateCurrentRecurringSchedule(input: { row: JobRow | null; payload: unknown; sessionId: string; listSchedules: () => Promise<unknown> }): Promise<RecurringScheduleValidation> {
  if (!isRecurringSchedulePayload(input.payload)) return { ok: false, reason: "invalid_payload" };
  if (!input.row) return { ok: false, reason: "missing_job" };
  const row = input.row;
  if (row.status !== "active") return { ok: false, reason: "inactive_job" };
  if (row.thread_mode !== "same_session" && row.thread_mode !== "new_session_per_run" && row.thread_mode !== "specific_session") return { ok: false, reason: "invalid_job" };
  if (input.payload.ownerEmail !== row.owner_email.toLowerCase()) return { ok: false, reason: "wrong_owner" };
  if (input.payload.sessionId !== row.session_id || row.session_id !== input.sessionId) return { ok: false, reason: "wrong_session" };
  if (!matchingJobPayload(row, input.payload)) return { ok: false, reason: "schedule_mismatch" };
  const identity = parseRecurringScheduleIdentity(row.schedule_id);
  if (!identity) return { ok: false, reason: "legacy_schedule_identity" };
  if (input.payload.generation !== identity.generation) return { ok: false, reason: "generation_mismatch" };
  let schedules: unknown;
  try {
    schedules = await input.listSchedules();
  } catch {
    return { ok: false, reason: "schedule_list_failed" };
  }
  if (!Array.isArray(schedules) || schedules.length > 100 || !schedules.every(isNativeRecurringSchedule)) return { ok: false, reason: "schedule_list_failed" };
  const schedule = schedules.find((candidate) => candidate.id === identity.nativeScheduleId);
  if (!schedule) return { ok: false, reason: "schedule_missing" };
  if (!matchingNativeInterval(schedule, row) || !sameRecurringSchedulePayload(input.payload, schedule.payload)) return { ok: false, reason: "schedule_mismatch" };
  return { ok: true };
}

export function recurringScheduleFence(row: Pick<JobRow, "id" | "owner_email" | "session_id" | "schedule_id">, generation: string): RecurringScheduleFence | null {
  const scheduleId = row.schedule_id;
  const identity = parseRecurringScheduleIdentity(scheduleId);
  if (!scheduleId || !identity || identity.generation !== generation) return null;
  return { jobId: row.id, ownerEmail: row.owner_email.toLowerCase(), sessionId: row.session_id, scheduleId, generation };
}

export function recurringScheduleFireKey(jobId: string, scheduledAt: Date, generation: string): string {
  return `recurring-v2:${jobId}:${scheduledAt.getTime()}:${generation}`;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validDispatchState(state: string | null): state is "dispatched" | "receipt_pending" {
  return state === "dispatched" || state === "receipt_pending";
}

export function recoveredRecurringScheduleDispatch(row: RecurringJobState, fence: RecurringScheduleFence, scheduledAt: Date): RecurringScheduleDispatchClaim | null {
  const fireKey = recurringScheduleFireKey(fence.jobId, scheduledAt, fence.generation);
  if (!validDispatchState(row.recurring_fire_state) || row.recurring_fire_key !== fireKey || row.recurring_fire_scheduled_at !== scheduledAt.toISOString()) return null;
  if (!row.recurring_fire_verifier_hash || !row.recurring_submission_id || !row.recurring_fire_target_session_id || !row.recurring_receipt_id) return null;
  return {
    ...fence,
    scheduledAt: scheduledAt.toISOString(),
    fireKey,
    verifierHash: row.recurring_fire_verifier_hash,
    submissionId: row.recurring_submission_id,
    targetSessionId: row.recurring_fire_target_session_id,
    receiptId: row.recurring_receipt_id,
  };
}

export async function claimRecurringScheduleDispatch(env: Env, fence: RecurringScheduleFence, scheduledAt: Date, targetSessionId: string): Promise<RecurringScheduleDispatchClaim | null> {
  const scheduledAtIso = scheduledAt.toISOString();
  const fireKey = recurringScheduleFireKey(fence.jobId, scheduledAt, fence.generation);
  const submissionId = crypto.randomUUID();
  const receiptId = crypto.randomUUID();
  const verifierHash = await sha256(crypto.randomUUID());
  const result = await env.DB.prepare(
    "UPDATE jobs SET recurring_fire_key = ?, recurring_fire_verifier_hash = ?, recurring_fire_state = 'dispatched', recurring_fire_scheduled_at = ?, recurring_submission_id = ?, recurring_fire_target_session_id = ?, recurring_receipt_id = ?, updated_at = datetime('now') WHERE id = ? AND owner_email = ? AND session_id = ? AND status = 'active' AND schedule_id = ? AND next_run_at = ? AND (recurring_fire_state IS NULL OR recurring_fire_state = 'terminal' OR recurring_fire_key <> ?)",
  ).bind(fireKey, verifierHash, scheduledAtIso, submissionId, targetSessionId, receiptId, fence.jobId, fence.ownerEmail, fence.sessionId, fence.scheduleId, scheduledAtIso, fireKey).run().catch(() => undefined);
  return result?.meta?.changes === 1 ? { ...fence, scheduledAt: scheduledAtIso, fireKey, verifierHash, submissionId, targetSessionId, receiptId } : null;
}

export function recurringScheduleRetryOptions() {
  return { retry: { maxAttempts: 1 } };
}

export function recurringScheduleRunMessageId(claim: RecurringScheduleDispatchClaim): string {
  return claim.submissionId;
}

export function recurringScheduleRunTargetSessionId(): string {
  return crypto.randomUUID();
}

export async function parkRecurringScheduleCancellation(env: Env, input: Pick<RecurringScheduleCancellation, "job_id" | "owner_email" | "session_id" | "schedule_id">): Promise<boolean> {
  const ownerEmail = input.owner_email.toLowerCase();
  const parked = await env.DB.prepare("INSERT OR IGNORE INTO recurring_schedule_cancellations (id, job_id, owner_email, session_id, schedule_id) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), input.job_id, ownerEmail, input.session_id, input.schedule_id).run();
  if (parked.meta?.changes === 1) return true;
  if (parked.meta?.changes !== 0) return false;
  const existing = await env.DB.prepare("SELECT id FROM recurring_schedule_cancellations WHERE owner_email = ? AND session_id = ? AND schedule_id = ?")
    .bind(ownerEmail, input.session_id, input.schedule_id).first<{ id: string }>();
  return !!existing;
}

export function computeNextRun(base: Date, cadenceSecs: number): string {
  return new Date(base.getTime() + cadenceSecs * 1000).toISOString();
}

export function validateJobInput(input: Partial<JobInput>): ValidationError | JobInput {
  const rawMode = typeof input.threadMode === "string" ? input.threadMode : "new_session_per_run";
  const isSpecific = rawMode === "specific_session";
  const sessionId = (input.sessionId ?? "").trim();
  if (!sessionId) return { tag: "InvalidInput", field: "sessionId", message: isSpecific ? "a Specific thread requires a thread id" : "required" };
  const name = (input.name ?? "").trim();
  if (!name) return { tag: "InvalidInput", field: "name", message: "required" };
  const prompt = (input.prompt ?? "").trim();
  if (!prompt) return { tag: "InvalidInput", field: "prompt", message: "required" };
  if (prompt.length > MAX_PROMPT_CHARS) return { tag: "InvalidInput", field: "prompt", message: `> ${MAX_PROMPT_CHARS} chars` };
  const cadenceSecs = Number(input.cadenceSecs);
  if (!Number.isInteger(cadenceSecs)) return { tag: "InvalidInput", field: "cadenceSecs", message: "must be an integer" };
  if (cadenceSecs < MIN_CADENCE_SECS || cadenceSecs > MAX_CADENCE_SECS) return { tag: "InvalidInput", field: "cadenceSecs", message: `must be in [${MIN_CADENCE_SECS}, ${MAX_CADENCE_SECS}]` };
  const threadMode = RECURRING_JOB_THREAD_MODES.includes(rawMode as RecurringJobThreadMode) ? rawMode as RecurringJobThreadMode : null;
  if (!threadMode) return { tag: "InvalidInput", field: "threadMode", message: "must be same_session, new_session_per_run, or specific_session" };
  return { sessionId, name: name.slice(0, MAX_NAME_CHARS), prompt: prompt.slice(0, MAX_PROMPT_CHARS), cadenceSecs, threadMode };
}

export const SCHEDULED_JOB_RUN_PREFIX = "You are executing one scheduled run of an existing recurring job. Do not create, update, resume, pause, delete, or schedule recurring jobs from this run unless the owner explicitly asked this run to modify job configuration. Do the requested check/work once, leave truthful receipts/notifications required by the prompt, then stop.";

export function scheduledJobRunPrompt(prompt: string): string {
  return `${SCHEDULED_JOB_RUN_PREFIX}\n\n${prompt}`;
}

export async function runJobNow(env: Env, row: JobRow, now: Date = new Date(), options: { clientMessageId?: string; persistTerminalState?: boolean; targetSessionId?: string } = {}): Promise<{ next_run_at: string; ok: boolean; error?: string; target_session_id: string; thread_mode: RecurringJobThreadMode }> {
  let ok = true;
  let error: string | undefined;
  const target = await resolveRecurringJobTargetSession(env, row, now, options.targetSessionId);
  try {
    const stub = await sessionAgent(env, row.owner_email, target.targetSessionId);
    await stub.seedIdentity({ email: row.owner_email, sub: `job:${row.owner_email}` });
    await stub.injectUserMessage({ content: scheduledJobRunPrompt(row.prompt), clientMsgId: options.clientMessageId ?? crypto.randomUUID() });
  } catch (caught) {
    ok = false;
    error = caught instanceof Error ? caught.message : String(caught);
  }
  const nextRunAt = computeNextRun(now, row.cadence_secs);
  if (options.persistTerminalState !== false && ok) {
    await env.DB.prepare("UPDATE jobs SET next_run_at = ?, last_run_at = ?, last_error = NULL, updated_at = datetime('now') WHERE id = ? AND owner_email = ?")
      .bind(nextRunAt, now.toISOString(), row.id, row.owner_email.toLowerCase()).run().catch(() => undefined);
  } else if (options.persistTerminalState !== false) {
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

export function requireScheduleId(schedule: { id?: string } | null | undefined): string {
  if (!schedule?.id) throw new Error("recurring job schedule did not return an id");
  return schedule.id;
}

export async function scheduleJob(env: Env, row: Pick<JobRow, "id" | "owner_email" | "session_id" | "thread_mode" | "prompt" | "cadence_secs">): Promise<string> {
  const stub = await sessionAgent(env, row.owner_email, row.session_id);
  const generation = crypto.randomUUID();
  await stub.seedIdentity({ email: row.owner_email, sub: `job:${row.owner_email}` });
  const schedule = await stub.scheduleRecurringPrompt({ ...currentRecurringSchedulePayload(row, generation), cadenceSecs: row.cadence_secs });
  return recurringScheduleIdentity(requireScheduleId(schedule), generation);
}

export async function cancelJobSchedule(env: Env, row: Pick<JobRow, "owner_email" | "session_id" | "schedule_id">): Promise<void> {
  if (!row.schedule_id) return;
  const stub = await sessionAgent(env, row.owner_email, row.session_id);
  await stub.cancelRecurringPrompt(nativeScheduleId(row.schedule_id)!);
}
