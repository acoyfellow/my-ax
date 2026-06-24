import type { OwnerNotification } from "./notify";

export interface RecurringJobReceiptInput {
  jobId: string;
  jobName?: string;
  sessionId: string;
  error?: string | null;
}

/** Build the authoritative owner-visible receipt for one terminal recurring-job run. */
export function recurringJobReceipt(input: RecurringJobReceiptInput): OwnerNotification {
  const name = input.jobName?.trim() || "Recurring job";
  const error = input.error?.replace(/[\r\n]+/g, " ").trim();
  return {
    kind: "job.complete",
    sessionId: input.sessionId,
    title: error ? `${name} failed` : `${name} completed`,
    body: error
      ? `${error.slice(0, 140)} Next action: open the conversation and retry or update the job.`
      : "Completed successfully. Next action: open the conversation to review the result.",
    href: `/?session=${encodeURIComponent(input.sessionId)}`,
    dedupeKey: `recurring-job:${input.jobId}`,
  };
}
