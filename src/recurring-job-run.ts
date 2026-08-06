import type { Env } from "./types";
import { recurringJobReceipt } from "./recurring-job-receipt";
import { isTransientRateLimit } from "./upstream-rate-limit";
import type { OwnerNotification } from "./notify";
import type { ThinkSubmissionInspection } from "@cloudflare/think";
import type { RecurringJobThreadMode, RecurringScheduleDispatchClaim } from "./jobs";

export function recurringSubmissionTerminalError(status: string, error?: string): string | null | undefined {
  if (status === "pending" || status === "running") return undefined;
  if (status === "completed") return null;
  if (status === "error") return error || "scheduled run failed";
  if (status === "aborted" || status === "skipped") return `scheduled run ${status}`;
  return "scheduled run ended in an unexpected terminal state";
}

export interface CompleteRecurringJobRunInput {
  jobId: string;
  ownerEmail: string;
  sessionId: string;
  sourceSessionId?: string | null;
  threadMode?: RecurringJobThreadMode;
  ranAt: Date;
  error?: string | null;
  nextRunAt?: string | null;
  jobName?: string | null;
  claim?: RecurringScheduleDispatchClaim | null;
}

export type RecurringSubmissionInspectionResult = "nonterminal" | "terminal";

export async function settleInspectedRecurringJobRun(env: Env, input: Omit<CompleteRecurringJobRunInput, "error"> & { submission: Pick<ThinkSubmissionInspection, "status" | "error"> }): Promise<RecurringSubmissionInspectionResult> {
  const error = recurringSubmissionTerminalError(input.submission.status, input.submission.error);
  if (error === undefined) return "nonterminal";
  await completeRecurringJobRun(env, { ...input, error });
  return "terminal";
}

function recurringTerminalNotification(input: CompleteRecurringJobRunInput, jobName: string | null, error: string | null): OwnerNotification {
  if (error && isTransientRateLimit(error)) {
    return {
      kind: "session.update",
      sessionId: input.sessionId,
      title: "My AX: paused on rate limit",
      body: "A recurring job is waiting out an inference rate limit and will retry automatically.",
      href: `/?session=${encodeURIComponent(input.sessionId)}`,
      dedupeKey: `rate-limited:${input.ownerEmail.toLowerCase()}`,
    };
  }
  return recurringJobReceipt({
    jobId: input.jobId,
    jobName: jobName ?? undefined,
    sessionId: input.sessionId,
    sourceSessionId: input.sourceSessionId ?? input.sessionId,
    threadMode: input.threadMode ?? "same_session",
    ranAt: input.ranAt,
    error,
  });
}

function batchSucceeded(value: unknown, expectedStatements: number): boolean {
  if (!Array.isArray(value) || value.length !== expectedStatements) return false;
  return value.every((result) => result !== null && typeof result === "object" && (result as { success?: unknown }).success !== false);
}

async function lookupJobName(env: Env, input: CompleteRecurringJobRunInput, ownerEmail: string): Promise<string | null> {
  if (input.jobName?.trim()) return input.jobName.trim();
  const job = await env.DB.prepare("SELECT name FROM jobs WHERE id = ? AND owner_email = ?")
    .bind(input.jobId, ownerEmail).first<{ name: string }>().catch(() => null);
  return job?.name?.trim() || null;
}

export async function completeRecurringJobRun(env: Env, input: CompleteRecurringJobRunInput): Promise<boolean> {
  const ownerEmail = input.ownerEmail.toLowerCase();
  const claim = input.claim ?? null;
  if (claim && (claim.ownerEmail !== ownerEmail || claim.jobId !== input.jobId || claim.targetSessionId !== input.sessionId)) return false;
  const error = input.error ? input.error.slice(0, 500) : null;
  const jobName = await lookupJobName(env, input, ownerEmail);
  const notification = recurringTerminalNotification(input, jobName, error);
  if (!claim) {
    const update = input.nextRunAt
      ? await env.DB.prepare("UPDATE jobs SET next_run_at = ?, last_run_at = ?, last_error = ?, updated_at = datetime('now') WHERE id = ? AND owner_email = ?")
        .bind(input.nextRunAt, input.ranAt.toISOString(), error, input.jobId, ownerEmail).run()
      : await env.DB.prepare("UPDATE jobs SET last_run_at = ?, last_error = ?, updated_at = datetime('now') WHERE id = ? AND owner_email = ?")
        .bind(input.ranAt.toISOString(), error, input.jobId, ownerEmail).run();
    if (update.meta?.changes !== 1) return false;
    const receipt = await env.DB.prepare("INSERT INTO attention_items(id, owner_email, session_id, kind, title, body, href, created_at, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)")
      .bind(crypto.randomUUID(), ownerEmail, notification.sessionId ?? null, notification.kind, notification.title, notification.body, notification.href ?? "/", notification.dedupeKey ?? null).run();
    return true;
  }
  const terminalState = input.nextRunAt
    ? "UPDATE jobs SET next_run_at = ?, last_run_at = ?, last_error = ?, recurring_fire_state = 'receipt_pending', updated_at = datetime('now') WHERE id = ? AND owner_email = ? AND session_id = ? AND status = 'active' AND schedule_id = ? AND recurring_fire_key = ? AND recurring_fire_verifier_hash = ? AND recurring_submission_id = ? AND recurring_fire_target_session_id = ? AND recurring_receipt_id = ? AND recurring_fire_state = 'dispatched'"
    : "UPDATE jobs SET last_run_at = ?, last_error = ?, recurring_fire_state = 'receipt_pending', updated_at = datetime('now') WHERE id = ? AND owner_email = ? AND session_id = ? AND status = 'active' AND schedule_id = ? AND recurring_fire_key = ? AND recurring_fire_verifier_hash = ? AND recurring_submission_id = ? AND recurring_fire_target_session_id = ? AND recurring_receipt_id = ? AND recurring_fire_state = 'dispatched'";
  const terminalBinds = input.nextRunAt
    ? [input.nextRunAt, input.ranAt.toISOString(), error, input.jobId, ownerEmail, claim.sessionId, claim.scheduleId, claim.fireKey, claim.verifierHash, claim.submissionId, claim.targetSessionId, claim.receiptId]
    : [input.ranAt.toISOString(), error, input.jobId, ownerEmail, claim.sessionId, claim.scheduleId, claim.fireKey, claim.verifierHash, claim.submissionId, claim.targetSessionId, claim.receiptId];
  const claimBinds = [input.jobId, ownerEmail, claim.sessionId, claim.scheduleId, claim.fireKey, claim.verifierHash, claim.submissionId, claim.targetSessionId, claim.receiptId];
  const results = await env.DB.batch([
    env.DB.prepare(terminalState).bind(...terminalBinds),
    env.DB.prepare("INSERT OR IGNORE INTO attention_items(id, owner_email, session_id, kind, title, body, href, created_at, dedupe_key) SELECT recurring_receipt_id, ?, ?, ?, ?, ?, ?, datetime('now'), ? FROM jobs WHERE id = ? AND owner_email = ? AND session_id = ? AND status = 'active' AND schedule_id = ? AND recurring_fire_key = ? AND recurring_fire_verifier_hash = ? AND recurring_submission_id = ? AND recurring_fire_target_session_id = ? AND recurring_receipt_id = ? AND recurring_fire_state = 'receipt_pending'")
      .bind(ownerEmail, notification.sessionId ?? null, notification.kind, notification.title, notification.body, notification.href ?? "/", notification.dedupeKey ?? null, ...claimBinds),
    env.DB.prepare("UPDATE jobs SET recurring_fire_state = 'terminal' WHERE id = ? AND owner_email = ? AND session_id = ? AND status = 'active' AND schedule_id = ? AND recurring_fire_key = ? AND recurring_fire_verifier_hash = ? AND recurring_submission_id = ? AND recurring_fire_target_session_id = ? AND recurring_receipt_id = ? AND recurring_fire_state = 'receipt_pending'")
      .bind(...claimBinds),
  ]);
  if (!batchSucceeded(results, 3)) throw new Error("recurring terminal persistence was not confirmed");
  const settled = (results[2] as { meta?: { changes?: unknown } }).meta?.changes === 1;
  return settled;
}
