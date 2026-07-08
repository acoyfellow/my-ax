import type { Env } from "./types";
import { notifyOwner } from "./notify";
import { recurringJobReceipt } from "./recurring-job-receipt";
import { isTransientRateLimit } from "./upstream-rate-limit";
import type { RecurringJobThreadMode } from "./jobs";

export function recurringJobIdFromClientMessageId(id: string | null | undefined): string | null {
  const match = typeof id === "string" ? /^job:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):\d+$/i.exec(id) : null;
  return match?.[1] ?? null;
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
}

/** Persist one terminal recurring-job run and emit the owner-visible receipt. */
export async function completeRecurringJobRun(env: Env, input: CompleteRecurringJobRunInput): Promise<void> {
  const ownerEmail = input.ownerEmail.toLowerCase();
  const error = input.error ? input.error.slice(0, 500) : null;
  if (input.nextRunAt) {
    await env.DB.prepare(
      "UPDATE jobs SET next_run_at = ?, last_run_at = ?, last_error = ?, updated_at = datetime('now') WHERE id = ? AND owner_email = ?",
    ).bind(input.nextRunAt, input.ranAt.toISOString(), error, input.jobId, ownerEmail).run().catch(() => undefined);
  } else {
    await env.DB.prepare(
      "UPDATE jobs SET last_run_at = ?, last_error = ?, updated_at = datetime('now') WHERE id = ? AND owner_email = ?",
    ).bind(input.ranAt.toISOString(), error, input.jobId, ownerEmail).run().catch(() => undefined);
  }
  // A transient upstream rate-limit (gateway 3021 / 429 / overloaded) is NOT an
  // actionable job failure: the next tick usually succeeds. We still persisted
  // last_error above for diagnostics, but we must NOT push a "<job> failed"
  // notification for it — that spammed the owner with "rate limit" pushes on
  // every tick. A persistently rate-limited job is surfaced via a single
  // coalesced heads-up (dedupeKey without ranAt => at most one per hour).
  if (error && isTransientRateLimit(error)) {
    await notifyOwner(env, ownerEmail, {
      kind: "session.update",
      sessionId: input.sessionId,
      title: "My AX: paused on rate limit",
      body: "A recurring job is waiting out an inference rate limit and will retry automatically.",
      href: `/?session=${encodeURIComponent(input.sessionId)}`,
      dedupeKey: `rate-limited:${ownerEmail}`,
    }).catch((notifyError) => console.error("recurring_job_ratelimit_notice_failed", { jobId: input.jobId, err: String(notifyError) }));
    return;
  }
  let jobName = input.jobName?.trim() || null;
  if (!jobName) {
    const job = await env.DB.prepare("SELECT name FROM jobs WHERE id = ? AND owner_email = ?")
      .bind(input.jobId, ownerEmail).first<{ name: string }>().catch(() => null);
    jobName = job?.name?.trim() || null;
  }
  await notifyOwner(env, ownerEmail, recurringJobReceipt({
    jobId: input.jobId,
    jobName: jobName ?? undefined,
    sessionId: input.sessionId,
    sourceSessionId: input.sourceSessionId ?? input.sessionId,
    threadMode: input.threadMode ?? "same_session",
    ranAt: input.ranAt,
    error,
  })).catch((notifyError) => console.error("recurring_job_receipt_failed", { jobId: input.jobId, err: String(notifyError) }));
}
