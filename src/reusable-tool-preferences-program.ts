import { Clock, Data, Effect } from "effect";
import { Database, type DatabaseError } from "./effect/database";
import {
  APPROVAL_MODE_KEY,
  parseApprovalMode,
  reusableToolOwnerEmail,
  type ReusableToolApprovalMode,
} from "./reusable-tool-preferences";

export class InvalidApprovalModeError extends Data.TaggedError("InvalidApprovalModeError")<{
  value: unknown;
}> {
  override get message(): string {
    return "approvalMode must be review or auto";
  }
}

function isMissingTable(error: DatabaseError): boolean {
  return String(error.cause).includes("no such table");
}

export function reusableToolApprovalMode(
  email: string,
  fallback: ReusableToolApprovalMode,
): Effect.Effect<ReusableToolApprovalMode, DatabaseError, Database> {
  return Effect.gen(function* () {
    const database = yield* Database;
    const row = yield* database.first<{ value_json: string }>(
      "SELECT value_json FROM owner_preferences WHERE owner_email = ? AND preference_key = ?",
      [reusableToolOwnerEmail(email), APPROVAL_MODE_KEY],
    ).pipe(Effect.catchTag("DatabaseError", (error) => isMissingTable(error) ? Effect.succeed(null) : Effect.fail(error)));
    return parseApprovalMode(row?.value_json) ?? fallback;
  });
}

export function setReusableToolApprovalMode(
  email: string,
  approvalMode: ReusableToolApprovalMode,
): Effect.Effect<ReusableToolApprovalMode, DatabaseError | InvalidApprovalModeError, Database> {
  return Effect.gen(function* () {
    if (approvalMode !== "review" && approvalMode !== "auto") {
      return yield* Effect.fail(new InvalidApprovalModeError({ value: approvalMode }));
    }
    const database = yield* Database;
    const now = new Date(yield* Clock.currentTimeMillis).toISOString();
    yield* database.run(
      `INSERT INTO owner_preferences (owner_email, preference_key, value_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(owner_email, preference_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      [reusableToolOwnerEmail(email), APPROVAL_MODE_KEY, JSON.stringify({ approvalMode }), now, now],
    );
    return approvalMode;
  });
}
