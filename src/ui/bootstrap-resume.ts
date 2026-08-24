export type LookupOutcome =
  | { kind: "found"; sessionId: string }
  | { kind: "empty" }
  | { kind: "offline"; message: string };

export interface ResumePlan {
  resumeId: string | null;
  forgetCachedSession: boolean;
  toast: string | null;
}

export function isOfflineFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /failed to fetch|networkerror|load failed|connection|offline/i.test(message);
}

export function classifyLookup(error: unknown): LookupOutcome {
  if (isOfflineFailure(error)) {
    return { kind: "offline", message: "You are offline. Your conversation will load when the connection returns." };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { kind: "offline", message: `Could not load your latest conversation: ${message}` };
}

export function planResume(input: { cached: string | null; outcome: LookupOutcome }): ResumePlan {
  const { cached, outcome } = input;

  if (outcome.kind === "found") {
    return { resumeId: outcome.sessionId, forgetCachedSession: false, toast: null };
  }

  if (outcome.kind === "empty") {
    return { resumeId: null, forgetCachedSession: true, toast: null };
  }

  if (cached) {
    return { resumeId: cached, forgetCachedSession: false, toast: null };
  }

  return { resumeId: null, forgetCachedSession: false, toast: outcome.message };
}
