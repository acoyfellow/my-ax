import type { OwnerNotification } from "./notify";
import type { RecurringJobThreadMode } from "./jobs";

export interface RecurringJobReceiptInput {
  jobId: string;
  jobName?: string;
  sessionId: string;
  sourceSessionId?: string;
  threadMode?: RecurringJobThreadMode;
  ranAt?: Date;
  runCount?: number | null;
  maxRuns?: number | null;
  error?: string | null;
}

function runProgress(input: RecurringJobReceiptInput, outcome: "completed" | "failed"): string | null {
  if (input.runCount === undefined || input.runCount === null) return null;
  if (input.maxRuns === undefined || input.maxRuns === null) return `Run ${input.runCount} ${outcome}. Runs remaining: unlimited.`;
  const remaining = Math.max(0, input.maxRuns - input.runCount);
  if (remaining === 0) return `Run ${input.runCount} of ${input.maxRuns} ${outcome}. This job is exhausted.`;
  return `Run ${input.runCount} of ${input.maxRuns} ${outcome}. Runs remaining: ${remaining}.`;
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
  const progress = runProgress(input, error ? "failed" : "completed");
  const title = input.runCount === undefined || input.runCount === null
    ? (error ? `${name} failed` : `${name} completed`)
    : (error ? `${name} run failed` : `${name} run completed`);
  return {
    kind: "job.complete",
    sessionId: targetSessionId,
    title,
    body: error
      ? `${error.slice(0, 120)}${progress ? ` ${progress}` : ""} Next action: open ${destination} and retry or update the job.`
      : `${progress ? `${progress} ` : ""}Completed successfully in ${destination}. Next action: open it to review the result.`,
    href,
    dedupeKey: `recurring-job:${input.jobId}:${targetSessionId}:${ranAt}`,
  };
}
