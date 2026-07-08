// Server-side pin/rank operations for conversations. Pure ordering logic lives
// here (testable without D1); the route wires it to the sessions table.

import type { Env } from "./types";
import { between, isValidRank, rankBefore } from "./fractional-index";

export type PinnedRow = { id: string; pin_rank: string | null };

/**
 * Compute the rank for moving `movedId` to sit immediately BEFORE `beforeId`
 * (or to the end when `beforeId` is null/absent), given the current ordered
 * pinned list. Pure: returns the new rank string, or throws on bad input.
 *
 * `ordered` must be the current pinned rows in display order (rank ASC). The
 * moved row is excluded from neighbor computation so a no-op move is stable.
 */
export function computeMoveRank(
  ordered: PinnedRow[],
  movedId: string,
  beforeId: string | null,
): string {
  const others = ordered.filter((r) => r.id !== movedId);
  if (beforeId === null) {
    // Move to the bottom: after the last other row.
    const last = others.length ? others[others.length - 1].pin_rank : null;
    return between(sanitize(last), null);
  }
  const idx = others.findIndex((r) => r.id === beforeId);
  if (idx < 0) {
    // Unknown anchor: fall back to top so the move still succeeds deterministically.
    return rankBefore(sanitize(others.length ? others[0].pin_rank : null));
  }
  const upper = sanitize(others[idx].pin_rank);
  const lower = idx > 0 ? sanitize(others[idx - 1].pin_rank) : null;
  return between(lower, upper);
}

function sanitize(rank: string | null): string | null {
  return rank !== null && isValidRank(rank) ? rank : null;
}

/** Rank to assign when pinning a conversation: it goes to the TOP of the
 *  pinned group, above the current first pinned row. */
export function rankForNewPin(currentTopRank: string | null): string {
  return rankBefore(sanitize(currentTopRank));
}

// ── D1-backed operations ────────────────────────────────────────────────────

async function currentPinned(env: Env, email: string): Promise<PinnedRow[]> {
  const result = await env.DB.prepare(
    "SELECT id, pin_rank FROM sessions WHERE owner_email = ? AND pinned = 1 ORDER BY pin_rank ASC, updated_at DESC",
  ).bind(email).all<PinnedRow>();
  return result.results ?? [];
}

export type PinResult = { id: string; pinned: boolean; pin_rank: string | null };

export async function setSessionPinned(env: Env, email: string, id: string, pinned: boolean): Promise<PinResult | null> {
  const owned = await env.DB.prepare("SELECT id FROM sessions WHERE id = ? AND owner_email = ?").bind(id, email).first<{ id: string }>();
  if (!owned) return null;
  if (pinned) {
    const existing = await currentPinned(env, email);
    const topRank = existing.length ? existing[0].pin_rank : null;
    const rank = rankForNewPin(topRank);
    await env.DB.prepare(
      "UPDATE sessions SET pinned = 1, pin_rank = ?, pin_updated_at = datetime('now') WHERE id = ? AND owner_email = ?",
    ).bind(rank, id, email).run();
    return { id, pinned: true, pin_rank: rank };
  }
  await env.DB.prepare(
    "UPDATE sessions SET pinned = 0, pin_rank = NULL, pin_updated_at = datetime('now') WHERE id = ? AND owner_email = ?",
  ).bind(id, email).run();
  return { id, pinned: false, pin_rank: null };
}

export async function reorderPinnedSession(env: Env, email: string, movedId: string, beforeId: string | null): Promise<PinResult | null> {
  const ordered = await currentPinned(env, email);
  if (!ordered.some((r) => r.id === movedId)) return null; // not pinned / not owned
  const rank = computeMoveRank(ordered, movedId, beforeId);
  await env.DB.prepare(
    "UPDATE sessions SET pin_rank = ?, pin_updated_at = datetime('now') WHERE id = ? AND owner_email = ? AND pinned = 1",
  ).bind(rank, movedId, email).run();
  return { id: movedId, pinned: true, pin_rank: rank };
}
