import type { NotificationKind, OwnerNotification } from "./notify";
import type { DelegateResult } from "./delegate-many";

function clip(value: string, max: number): string {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

export function delegateCompletionNotification(input: {
  sessionId: string;
  results: DelegateResult[];
}): OwnerNotification {
  // A "deferred" task is shared-inference-rate-limit backpressure (3021): it was
  // intentionally not launched and re-runs on its own. That is benign and
  // self-healing, NOT a failure the owner must act on — so it never triggers a
  // "needs review" alarm. Only genuine non-completions (error/aborted/
  // interrupted) are actionable.
  const actionable = input.results.filter((result) => result.status !== "completed" && result.status !== "deferred");
  const deferred = input.results.filter((result) => result.status === "deferred");
  const completed = input.results.filter((result) => result.status === "completed").length;
  const title = actionable.length ? "Delegation needs review" : "Delegation complete";
  const deferredNote = deferred.length ? ` ${deferred.length} deferred on an inference rate limit and will re-run.` : "";
  const body = actionable.length
    ? `${actionable.length}/${input.results.length} delegated task${input.results.length === 1 ? "" : "s"} did not complete.${deferredNote} Open the conversation for the parent synthesis and next action.`
    : `${completed} delegated task${completed === 1 ? "" : "s"} completed.${deferredNote} Open the conversation for the parent synthesis and evidence.`;
  return {
    kind: (actionable.length ? "delegate.needs_input" : "delegate.complete") as NotificationKind,
    sessionId: input.sessionId,
    title,
    body: clip(body, 200),
    href: `/?session=${encodeURIComponent(input.sessionId)}`,
    dedupeKey: `delegate:${input.sessionId}:${input.results.map((result) => result.runId).join(":")}`,
  };
}
