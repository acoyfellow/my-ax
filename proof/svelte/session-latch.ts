// Pure helpers for per-session latches and pending-first-message binding.
// Extracted so the fail-closed freshness rules can be unit-tested without a
// DOM. Chat.svelte inlines the equivalent logic against localStorage/
// sessionStorage; these functions encode the same invariants.

export type ActiveTurnLatch = {
  id: string;
  clientMsgId: string;
  at: number;
  sessionId: string;
};

export const ACTIVE_TURN_MAX_AGE_MS = 86_400_000; // 24h

/**
 * Decide whether a stored active-turn latch should be restored for the
 * currently mounted session. Fail closed: reject latches that are missing an
 * id, not bound to this session (including legacy latches without a
 * sessionId), or older than the max age.
 */
export function activeTurnIsRestorable(
  saved: Partial<ActiveTurnLatch> | null | undefined,
  currentSessionId: string,
  now: number = Date.now(),
): saved is ActiveTurnLatch {
  if (!saved || !saved.id) return false;
  if (saved.sessionId !== currentSessionId) return false;
  if (now - Number(saved.at || 0) >= ACTIVE_TURN_MAX_AGE_MS) return false;
  return true;
}

/**
 * Decide whether a stashed pending-first-message payload belongs to the
 * session now mounted. Fail closed: a payload bound to a different session is
 * not adopted. A payload with no bound session (legacy) is treated as
 * belonging here for backward compatibility, but callers should always write
 * the binding going forward.
 */
export function pendingFirstBelongsHere(
  boundSessionId: string | null | undefined,
  currentSessionId: string,
): boolean {
  if (!boundSessionId) return true;
  return boundSessionId === currentSessionId;
}
