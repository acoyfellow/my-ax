import { Effect } from "effect";
import { Database, type DatabaseError } from "./effect/database";
import {
  MAX_PINNED,
  PinLimitError,
  computeMoveRank,
  rankForNewPin,
  type PinResult,
  type PinnedRow,
} from "./session-pinning";

function currentPinned(email: string): Effect.Effect<readonly PinnedRow[], DatabaseError, Database> {
  return Effect.gen(function* () {
    const database = yield* Database;
    return yield* database.all<PinnedRow>(
      "SELECT id, pin_rank FROM sessions WHERE owner_email = ? AND pinned = 1 ORDER BY pin_rank ASC, updated_at DESC",
      [email],
    );
  });
}

export function setSessionPinned(
  email: string,
  id: string,
  pinned: boolean,
): Effect.Effect<PinResult | null, DatabaseError | PinLimitError, Database> {
  return Effect.gen(function* () {
    const database = yield* Database;
    const owned = yield* database.first<{ id: string }>(
      "SELECT id FROM sessions WHERE id = ? AND owner_email = ?",
      [id, email],
    );
    if (!owned) return null;
    if (pinned) {
      const existing = yield* currentPinned(email);
      if (existing.length >= MAX_PINNED && !existing.some((row) => row.id === id)) {
        return yield* Effect.fail(new PinLimitError());
      }
      const rank = rankForNewPin(existing.length ? existing[0]?.pin_rank ?? null : null);
      yield* database.run(
        "UPDATE sessions SET pinned = 1, pin_rank = ?, pin_updated_at = datetime('now') WHERE id = ? AND owner_email = ?",
        [rank, id, email],
      );
      return { id, pinned: true, pin_rank: rank };
    }
    yield* database.run(
      "UPDATE sessions SET pinned = 0, pin_rank = NULL, pin_updated_at = datetime('now') WHERE id = ? AND owner_email = ?",
      [id, email],
    );
    return { id, pinned: false, pin_rank: null };
  });
}

export function reorderPinnedSession(
  email: string,
  movedId: string,
  beforeId: string | null,
): Effect.Effect<PinResult | null, DatabaseError, Database> {
  return Effect.gen(function* () {
    const database = yield* Database;
    const ordered = yield* currentPinned(email);
    if (!ordered.some((row) => row.id === movedId)) return null;
    const rank = computeMoveRank([...ordered], movedId, beforeId);
    yield* database.run(
      "UPDATE sessions SET pin_rank = ?, pin_updated_at = datetime('now') WHERE id = ? AND owner_email = ? AND pinned = 1",
      [rank, movedId, email],
    );
    return { id: movedId, pinned: true, pin_rank: rank };
  });
}
