import { Clock, Data, Effect } from "effect";
import { Database, type DatabaseError } from "./effect/database";
import { runEventId, type AppendRunEventInput, type AppendRunEventResult } from "./run-receipts";

export class RunReceiptOperationError extends Data.TaggedError("RunReceiptOperationError")<{
  operation: "lookup" | "insert" | "update";
  cause: unknown;
}> {}

export class RunReceiptNotFoundEffectError extends Data.TaggedError("RunReceiptNotFoundEffectError") {}
export class RunReceiptTerminalEffectError extends Data.TaggedError("RunReceiptTerminalEffectError") {}

export function appendOwnedRunEvent(
  email: string,
  runId: string,
  input: AppendRunEventInput,
): Effect.Effect<AppendRunEventResult, DatabaseError | RunReceiptOperationError | RunReceiptNotFoundEffectError | RunReceiptTerminalEffectError, Database> {
  return Effect.gen(function* () {
    const database = yield* Database;
    const run = yield* database.first<{ id: string; status: string }>(
      "SELECT id, status FROM runs WHERE id = ? AND owner_email = ?",
      [runId, email],
    );
    if (!run) return yield* Effect.fail(new RunReceiptNotFoundEffectError());
    if (["completed", "failed", "aborted"].includes(run.status)) return yield* Effect.fail(new RunReceiptTerminalEffectError());
    const type = input.type.trim();
    const id = input.event_id?.trim() || runEventId(type);
    const ts = new Date(yield* Clock.currentTimeMillis).toISOString();
    const data = input.data && typeof input.data === "object" ? input.data : {};
    const evidence = input.evidence && typeof input.evidence === "object" ? input.evidence : null;
    yield* database.run(
      "INSERT INTO run_events (run_id, event_id, owner_email, ts, actor_json, type, data_json, evidence_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [runId, id, email, ts, JSON.stringify(input.actor), type, JSON.stringify(data), evidence ? JSON.stringify(evidence) : null],
    );
    yield* database.run(
      "UPDATE runs SET status = CASE WHEN status = 'open' THEN 'running' ELSE status END, updated_at = datetime('now') WHERE id = ? AND owner_email = ?",
      [runId, email],
    );
    return { runId, eventId: id, type };
  });
}
