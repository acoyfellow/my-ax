import { Clock, Effect } from "effect";
import {
  DEFAULT_STARTERS,
  STARTERS_KEY,
  normalizeStarters,
  type ConversationStarter,
} from "./conversation-starters";
import { Database, type DatabaseError } from "./effect/database";

function ownerEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isMissingTable(error: DatabaseError): boolean {
  return String(error.cause).includes("no such table");
}

export function getConversationStarters(email: string): Effect.Effect<ConversationStarter[], DatabaseError, Database> {
  return Effect.gen(function* () {
    const database = yield* Database;
    const row = yield* database.first<{ value_json: string }>(
      "SELECT value_json FROM owner_preferences WHERE owner_email = ? AND preference_key = ?",
      [ownerEmail(email), STARTERS_KEY],
    ).pipe(Effect.catchTag("DatabaseError", (error) => isMissingTable(error) ? Effect.succeed(null) : Effect.fail(error)));
    if (row?.value_json) {
      const parsed = JSON.parse(row.value_json) as { starters?: unknown };
      const starters = normalizeStarters(parsed.starters);
      if (starters.length) return starters;
    }
    return DEFAULT_STARTERS;
  });
}

export function setConversationStarters(email: string, input: unknown): Effect.Effect<ConversationStarter[], DatabaseError, Database> {
  return Effect.gen(function* () {
    const database = yield* Database;
    const starters = normalizeStarters(input);
    const toStore = starters.length ? starters : DEFAULT_STARTERS;
    const now = new Date(yield* Clock.currentTimeMillis).toISOString();
    yield* database.run(
      `INSERT INTO owner_preferences (owner_email, preference_key, value_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(owner_email, preference_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      [ownerEmail(email), STARTERS_KEY, JSON.stringify({ starters: toStore }), now, now],
    );
    return toStore;
  });
}
