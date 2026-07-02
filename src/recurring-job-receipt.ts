import type { OwnerNotification } from "./notify";
import type { RecurringJobThreadMode } from "./jobs";

export interface RecurringJobReceiptInput {
  jobId: string;
  jobName?: string;
  sessionId: string;
  sourceSessionId?: string;
  threadMode?: RecurringJobThreadMode;
  ranAt?: Date;
  error?: string | null;
}

/** Build the authoritative owner-visible receipt for one terminal recurring-job run. */
export function recurringJobReceipt(input: RecurringJobReceiptInput): OwnerNotification {
  const name = input.jobName?.trim() || "Recurring job";
  const error = input.error?.replace(/[\r\n]+/g, " ").trim();
  const threadMode = input.threadMode ?? "same_session";
  const targetSessionId = input.sessionId;
  const href = `/?session=${encodeURIComponent(targetSessionId)}`;
  const ranAt = input.ranAt?.toISOString() ?? new Date(0).toISOString();
  const destination = threadMode === "new_session_per_run" ? "a new conversation" : "the existing conversation";
  return {
    kind: "job.complete",
    sessionId: targetSessionId,
    title: error ? `${name} failed` : `${name} completed`,
    body: error
      ? `${error.slice(0, 120)} Next action: open ${destination} and retry or update the job.`
      : `Completed successfully in ${destination}. Next action: open it to review the result.`,
    href,
    dedupeKey: `recurring-job:${input.jobId}:${targetSessionId}:${ranAt}`,
  };
}
