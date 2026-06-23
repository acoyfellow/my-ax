export const DEAD_SESSION_STALL_MS = 5 * 60 * 1000;

export interface RecentConversationEntry {
  id: number;
  role: string;
  content: string | null;
  meta_json?: string | null;
}

export interface DeadSessionResult {
  latestUserEntryId: number;
  latestUserMessage: string;
}

/** Decide whether a stale session has an unanswered user turn. Entries must be ordered oldest-first. */
export function detectDeadSession(
  entries: readonly RecentConversationEntry[],
  updatedAt: string,
  now: Date,
  stallMs = DEAD_SESSION_STALL_MS,
): DeadSessionResult | null {
  if (!entries.length || entries.at(-1)?.role === "assistant") return null;
  const updatedMs = Date.parse(updatedAt);
  if (!Number.isFinite(updatedMs) || now.getTime() - updatedMs < stallMs) return null;

  let latestUserIndex = -1;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index]?.role === "user") {
      latestUserIndex = index;
      break;
    }
  }
  if (latestUserIndex < 0) return null;
  if (entries.slice(latestUserIndex + 1).some((entry) => entry.role === "assistant")) return null;
  const latestUser = entries[latestUserIndex]!;
  return { latestUserEntryId: latestUser.id, latestUserMessage: latestUser.content ?? "" };
}

export const AUTO_REVIVE_PREFIX = "auto-revive:";

/** True when an entry was produced by a prior automatic revival. */
export function isAutoRevive(entry: RecentConversationEntry | undefined): boolean {
  if (!entry?.meta_json) return false;
  try {
    const id = (JSON.parse(entry.meta_json) as { uiMessageId?: unknown }).uiMessageId;
    return typeof id === "string" && id.startsWith(AUTO_REVIVE_PREFIX);
  } catch {
    return false;
  }
}
