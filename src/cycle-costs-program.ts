import { Clock, Effect, Layer } from "effect";
import { cycleCostPoint, type CycleCostInput, type CycleCostPoint, type CycleCostRow } from "./cycle-costs";
import { Database, databaseLayer, type DatabaseBinding, type DatabaseError } from "./effect/database";
import { IdGenerator, idGeneratorLive } from "./effect/id-generator";

export function cycleCostLayer(database: DatabaseBinding) {
  return Layer.mergeAll(databaseLayer(database), idGeneratorLive);
}

function owner(ownerEmail: string): string {
  return ownerEmail.toLowerCase();
}

export function nextCycleIndex(
  ownerEmail: string,
  sessionOrRunId: string,
): Effect.Effect<number, DatabaseError, Database> {
  return Effect.gen(function* () {
    const database = yield* Database;
    const row = yield* database.first<{ next: number }>(
      "SELECT COALESCE(MAX(cycle_index), -1) + 1 AS next FROM cycle_costs WHERE owner_email = ? AND session_or_run_id = ?",
      [owner(ownerEmail), sessionOrRunId],
    );
    return row?.next ?? 0;
  });
}

export function recordCycleCost(
  input: CycleCostInput,
): Effect.Effect<{ id: string }, DatabaseError, Database | IdGenerator> {
  return Effect.gen(function* () {
    const database = yield* Database;
    const ids = yield* IdGenerator;
    const id = yield* ids.next;
    const ts = input.ts ?? new Date(yield* Clock.currentTimeMillis).toISOString();
    yield* database.run(
      `INSERT INTO cycle_costs (id, owner_email, session_or_run_id, cycle_index, ts, model, finish_reason, input_tokens, output_tokens, total_tokens, usage_basis, recipes_used_json, recipes_saved_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        owner(input.ownerEmail),
        input.sessionOrRunId,
        input.cycleIndex,
        ts,
        input.model ?? null,
        input.finishReason ?? null,
        input.usage.inputTokens,
        input.usage.outputTokens,
        input.usage.totalTokens,
        input.usage.basis,
        JSON.stringify(input.recipesUsed ?? []),
        JSON.stringify(input.recipesSaved ?? []),
      ],
    );
    return { id };
  });
}

export function readCycleCostSeries(
  ownerEmail: string,
  sessionOrRunId: string,
): Effect.Effect<CycleCostPoint[], DatabaseError, Database> {
  return Effect.gen(function* () {
    const database = yield* Database;
    const rows = yield* database.all<CycleCostRow>(
      "SELECT * FROM cycle_costs WHERE owner_email = ? AND session_or_run_id = ? ORDER BY cycle_index ASC, ts ASC",
      [owner(ownerEmail), sessionOrRunId],
    );
    return rows.map(cycleCostPoint);
  });
}
