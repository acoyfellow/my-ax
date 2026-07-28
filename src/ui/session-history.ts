import type { SessionGeneration } from "./session-generation";

export type RestoreOutcome = "restored" | "empty" | "stale";
export const shouldReportEmptyRestore = (outcome: RestoreOutcome): boolean => outcome === "empty";

export type SessionHistoryResult<T> =
  | { outcome: "stale" }
  | { outcome: "current"; entries: T[] };

type Page<T> = { entries?: T[]; hasMore?: boolean; nextCursor?: string };

/**
 * Shared async boundary for session transcript work. It checks generation before
 * and after every page, including JSON decoding, so callers can distinguish a
 * current empty transcript from cancelled work for an old session.
 */
export async function loadCurrentSessionEntries<T>(options: {
  expected: SessionGeneration;
  isCurrent: (expected: SessionGeneration) => boolean;
  fetchPage: (after: string) => Promise<{ ok: boolean; json(): Promise<{ result?: Page<T> }> }>;
  maxPages: number;
}): Promise<SessionHistoryResult<T>> {
  const entries: T[] = [];
  let after = "0";
  for (let page = 0; page < options.maxPages; page++) {
    if (!options.isCurrent(options.expected)) return { outcome: "stale" };
    const response = await options.fetchPage(after);
    if (!response.ok || !options.isCurrent(options.expected)) return { outcome: "stale" };
    const body = await response.json();
    if (!options.isCurrent(options.expected)) return { outcome: "stale" };
    const next = body?.result?.entries ?? [];
    entries.push(...next);
    if (!body?.result?.hasMore || next.length === 0) break;
    after = body.result.nextCursor ?? after;
  }
  return options.isCurrent(options.expected)
    ? { outcome: "current", entries }
    : { outcome: "stale" };
}
