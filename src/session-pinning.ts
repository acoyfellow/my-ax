// Server-side pin/rank operations for conversations. Pure ordering logic lives
// here (testable without D1); the route wires it to the sessions table.

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
  // Moving a row before itself is a stable no-op: keep its current valid rank.
  // (Without this, filtering out the moved row makes its own id an "unknown"
  // anchor and wrongly sends it to the top.)
  if (beforeId === movedId) {
    const self = ordered.find((r) => r.id === movedId);
    const selfRank = sanitize(self?.pin_rank ?? null);
    if (selfRank) return selfRank;
  }
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

export type PinResult = { id: string; pinned: boolean; pin_rank: string | null };

/** Upper bound on how many conversations one owner may pin. Keeps the pinned
 *  group scannable and bounds fractional-rank string growth. Re-pinning an
 *  already-pinned conversation is idempotent and never counts against it. */
export const MAX_PINNED = 20;

/** Thrown when pinning a NEW conversation would exceed MAX_PINNED. The route
 *  maps this to a 409 so the client can prompt the owner to unpin something. */
export class PinLimitError extends Error {
  readonly code = "PinLimit" as const;
  readonly limit = MAX_PINNED;
  constructor() {
    super(`You can pin at most ${MAX_PINNED} conversations. Unpin one to pin another.`);
    this.name = "PinLimitError";
  }
}
