import type { Env } from "./types";
import { notifyOwner } from "./notify";
import { recurringJobReceipt } from "./recurring-job-receipt";
import type { RecurringJobThreadMode } from "./jobs";

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
