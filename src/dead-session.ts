import type { Env } from "./types";
import { getSessionAgent } from "./agent-stub";
import { notifyOwner } from "./notify";
import { AUTO_REVIVE_PREFIX, DEAD_SESSION_STALL_MS, deadSessionRecoveryPlan, detectDeadSession, isDeadSessionAttentionForCurrentTurn, type RecentConversationEntry } from "./dead-session-detector";

export { DEAD_SESSION_STALL_MS, detectDeadSession } from "./dead-session-detector";
export const DEAD_SESSION_ATTENTION_KIND = "session.dead";

type SessionRow = { id: string; owner_email: string; updated_at: string };

export async function scanDeadSessions(env: Env, now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - DEAD_SESSION_STALL_MS).toISOString();
  // A turn that dies mid-flight is left status='running' (set at turn start and
  // only settled to 'active' by onChatResponse), so scanning 'active' alone
  // would miss the exact dead-mid-turn case. Include 'running' past the stall
  // window; 'interrupted'/'error' are already terminalized and excluded.
  const sessions = await env.DB.prepare(
    "SELECT id, owner_email, updated_at FROM sessions WHERE status IN ('active', 'running') AND updated_at < ? ORDER BY updated_at DESC LIMIT 50",
  ).bind(cutoff).all<SessionRow>();

  for (const session of sessions.results ?? []) {
    try {
      const ownerEmail = session.owner_email?.trim().toLowerCase();
      if (!ownerEmail) throw new Error("session owner is missing");
      const recent = await env.DB.prepare(
        `SELECT id, ts, role, content, meta_json FROM (
          SELECT id, ts, role, content, meta_json FROM conversation_entries
          WHERE session_id = ? AND owner_email = ? ORDER BY id DESC LIMIT 12
        ) ORDER BY id ASC`,
      ).bind(session.id, ownerEmail).all<RecentConversationEntry>();
      const dead = detectDeadSession(recent.results ?? [], session.updated_at, now);
      if (!dead) continue;

      // Retry the original dead turn silently. The owner only needs attention if
      // that one automatic recovery also stalls; notifying both before and after
      // retry made one incident look like two repeating failures.
      const latestUserEntry = (recent.results ?? []).find((entry) => entry.id === dead.latestUserEntryId);
      if (!latestUserEntry) continue;
      const incident = deadSessionRecoveryPlan(latestUserEntry);
      if (incident.action === "retry_silently") {
        const stub = await getSessionAgent(env, ownerEmail, session.id);
        await stub.seedIdentity({ email: ownerEmail, sub: "system:auto-revive" });
        await stub.injectUserMessage({ content: dead.latestUserMessage, clientMsgId: `${AUTO_REVIVE_PREFIX}${incident.originalUserEntryId}` });
        continue;
      }

      // The retry row carries auto-revive:<original user entry id>, so repeated
      // scans stay attached to one owner-visible incident and never re-inject.
      const latestUserCreatedAt = latestUserEntry.ts ?? session.updated_at;
      const priorAttention = await env.DB.prepare(
        "SELECT id, created_at FROM attention_items WHERE owner_email = ? AND session_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1",
      ).bind(ownerEmail, session.id, DEAD_SESSION_ATTENTION_KIND).first<{ id: string; created_at: string }>();
      const attention = priorAttention && isDeadSessionAttentionForCurrentTurn(priorAttention.created_at, latestUserCreatedAt) ? priorAttention : null;
      if (!attention) {
        await notifyOwner(env, ownerEmail, {
          kind: DEAD_SESSION_ATTENTION_KIND,
          title: "Session needs attention",
          body: "A conversation stopped before replying and its automatic retry did not recover it.",
          href: `/?session=${encodeURIComponent(session.id)}`,
          sessionId: session.id,
          dedupeKey: `session-dead:${session.id}:${incident.originalUserEntryId}`,
        });
      }
    } catch (error) {
      console.error("dead_session_scan_failed", {
        sessionId: session.id,
        ownerEmail: session.owner_email,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
