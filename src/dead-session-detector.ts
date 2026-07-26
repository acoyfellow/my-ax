export const DEAD_SESSION_STALL_MS = 5 * 60 * 1000;

export interface RecentConversationEntry {
  id: number;
  role: string;
  content: string | null;
  ts?: string | null;
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
  // Refuse recovery when the latest user row has no usable content: silently
  // re-injecting "" would replay an EMPTY message into a live conversation.
  // Fail closed — no dead-session incident rather than an empty auto-revive.
  if (typeof latestUser.content !== "string" || latestUser.content.length === 0) return null;
  return { latestUserEntryId: latestUser.id, latestUserMessage: latestUser.content };
}

export function isDeadSessionAttentionForCurrentTurn(attentionCreatedAt: string | null | undefined, latestUserCreatedAt: string | null | undefined): boolean {
  if (!attentionCreatedAt || !latestUserCreatedAt) return false;
  const attentionMs = Date.parse(attentionCreatedAt);
  const latestUserMs = Date.parse(latestUserCreatedAt);
  return Number.isFinite(attentionMs) && Number.isFinite(latestUserMs) && attentionMs >= latestUserMs;
}

export const AUTO_REVIVE_PREFIX = "auto-revive:";

export type DeadSessionIncident = {
  alreadyRevived: boolean;
  originalUserEntryId: number;
};

export type DeadSessionRecoveryPlan = DeadSessionIncident & {
  action: "retry_silently" | "notify_owner";
};

/** Keep an automatic retry attached to the original dead turn. The retry is a
 * recovery attempt, not a second owner-visible incident. */
export function deadSessionIncident(entry: RecentConversationEntry): DeadSessionIncident {
  if (!entry.meta_json) return { alreadyRevived: false, originalUserEntryId: entry.id };
  try {
    const id = (JSON.parse(entry.meta_json) as { uiMessageId?: unknown }).uiMessageId;
    if (typeof id !== "string" || !id.startsWith(AUTO_REVIVE_PREFIX)) {
      return { alreadyRevived: false, originalUserEntryId: entry.id };
    }
    const originalUserEntryId = Number(id.slice(AUTO_REVIVE_PREFIX.length));
    return {
      alreadyRevived: true,
      originalUserEntryId: Number.isSafeInteger(originalUserEntryId) && originalUserEntryId > 0
        ? originalUserEntryId
        : entry.id,
    };
  } catch {
    return { alreadyRevived: false, originalUserEntryId: entry.id };
  }
}

/** One dead incident gets at most one automatic retry and one owner alert. */
export function deadSessionRecoveryPlan(entry: RecentConversationEntry): DeadSessionRecoveryPlan {
  const incident = deadSessionIncident(entry);
  return {
    ...incident,
    action: incident.alreadyRevived ? "notify_owner" : "retry_silently",
  };
}

/** True when an entry was produced by a prior automatic revival. */
export function isAutoRevive(entry: RecentConversationEntry | undefined): boolean {
  return entry ? deadSessionIncident(entry).alreadyRevived : false;
}

export const DEAD_SESSION_ATTENTION_KIND = "session.dead";

export interface DeadSessionDb {
  prepare(sql: string): {
    bind(...binds: unknown[]): {
      all<T = unknown>(): Promise<{ results?: T[] }>;
      first<T = unknown>(): Promise<T | null>;
      run(): Promise<unknown>;
    };
  };
}

export interface DeadSessionDeps {
  reviveTurn: (ownerEmail: string, sessionId: string, message: string, clientMsgId: string) => Promise<void>;
  alertOwner: (ownerEmail: string, sessionId: string, dedupeSuffix: number) => Promise<void>;
}

type DeadSessionRow = { id: string; owner_email: string; updated_at: string };

export async function runDeadSessionScan(db: DeadSessionDb, deps: DeadSessionDeps, now: Date, stallMs = DEAD_SESSION_STALL_MS): Promise<void> {
  const cutoff = new Date(now.getTime() - stallMs).toISOString();
  const sessions = await db.prepare(
    "SELECT id, owner_email, updated_at FROM sessions WHERE status IN ('active', 'running') AND updated_at < ? ORDER BY updated_at ASC, id ASC LIMIT 50",
  ).bind(cutoff).all<DeadSessionRow>();

  for (const session of sessions.results ?? []) {
    try {
      const ownerEmail = session.owner_email?.trim().toLowerCase();
      if (!ownerEmail) throw new Error("session owner is missing");
      const recent = await db.prepare(
        `SELECT id, ts, role, content, meta_json FROM (
          SELECT id, ts, role, content, meta_json FROM conversation_entries
          WHERE session_id = ? AND owner_email = ? ORDER BY id DESC LIMIT 12
        ) ORDER BY id ASC`,
      ).bind(session.id, ownerEmail).all<RecentConversationEntry>();
      const dead = detectDeadSession(recent.results ?? [], session.updated_at, now, stallMs);
      if (!dead) continue;

      const latestUserEntry = (recent.results ?? []).find((entry) => entry.id === dead.latestUserEntryId);
      if (!latestUserEntry) continue;
      const incident = deadSessionRecoveryPlan(latestUserEntry);
      if (incident.action === "retry_silently") {
        await deps.reviveTurn(ownerEmail, session.id, dead.latestUserMessage, `${AUTO_REVIVE_PREFIX}${incident.originalUserEntryId}`);
        continue;
      }

      const latestUserCreatedAt = latestUserEntry.ts ?? session.updated_at;
      const priorAttention = await db.prepare(
        "SELECT id, created_at FROM attention_items WHERE owner_email = ? AND session_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1",
      ).bind(ownerEmail, session.id, DEAD_SESSION_ATTENTION_KIND).first<{ id: string; created_at: string }>();
      const attention = priorAttention && isDeadSessionAttentionForCurrentTurn(priorAttention.created_at, latestUserCreatedAt) ? priorAttention : null;
      if (!attention) {
        await deps.alertOwner(ownerEmail, session.id, incident.originalUserEntryId);
      }
      await db.prepare(
        "UPDATE sessions SET status = 'interrupted', updated_at = updated_at WHERE id = ? AND owner_email = ? AND status IN ('active', 'running')",
      ).bind(session.id, ownerEmail).run();
    } catch (error) {
      console.error("dead_session_scan_failed", {
        sessionId: session.id,
        ownerEmail: session.owner_email,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
