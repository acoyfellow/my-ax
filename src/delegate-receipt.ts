import type { NotificationKind, OwnerNotification } from "./notify";
import type { DelegateResult } from "./delegate-many";

function clip(value: string, max: number): string {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

export function delegateCompletionNotification(input: {
  sessionId: string;
  results: DelegateResult[];
}): OwnerNotification {
  const failed = input.results.filter((result) => result.status !== "completed");
  const completed = input.results.length - failed.length;
  const title = failed.length ? "Delegation needs review" : "Delegation complete";
  const body = failed.length
    ? `${failed.length}/${input.results.length} delegated task${input.results.length === 1 ? "" : "s"} did not complete. Open the conversation for the parent synthesis and next action.`
    : `${completed} delegated task${completed === 1 ? "" : "s"} completed. Open the conversation for the parent synthesis and evidence.`;
  return {
    kind: (failed.length ? "delegate.needs_input" : "delegate.complete") as NotificationKind,
    sessionId: input.sessionId,
    title,
    body: clip(body, 200),
    href: `/?session=${encodeURIComponent(input.sessionId)}`,
    dedupeKey: `delegate:${input.sessionId}:${input.results.map((result) => result.runId).join(":")}`,
  };
}
