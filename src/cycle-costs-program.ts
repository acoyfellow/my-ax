import { Clock, Effect, Layer } from "effect";
import {
  costSummary,
  costSummaryWindow,
  cycleCostPoint,
  type CostSummary,
  type CostSummaryModelRow,
  type CostSummaryTotalsRow,
  type CycleCostInput,
  type CycleCostPoint,
  type CycleCostRow,
} from "./cycle-costs";
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

export function readCostSummary(
  ownerEmail: string,
  labelFor: (model: string) => string | undefined,
): Effect.Effect<CostSummary, DatabaseError, Database> {
  return Effect.gen(function* () {
    const database = yield* Database;
    const window = costSummaryWindow(yield* Clock.currentTimeMillis);
    const totals = yield* database.first<CostSummaryTotalsRow>(
      `SELECT
         COALESCE(SUM(CASE WHEN ts >= ? THEN total_tokens END), 0) AS today_tokens,
         COALESCE(SUM(total_tokens), 0) AS week_tokens,
         COUNT(*) AS cycles,
         COUNT(DISTINCT session_or_run_id) AS sessions
       FROM cycle_costs
       WHERE owner_email = ? AND ts >= ?`,
      [window.todayStart, owner(ownerEmail), window.weekStart],
    );
    const models = yield* database.all<CostSummaryModelRow>(
      `SELECT model, COALESCE(SUM(total_tokens), 0) AS tokens, COUNT(*) AS cycles
       FROM cycle_costs
       WHERE owner_email = ? AND ts >= ?
       GROUP BY model
       ORDER BY tokens DESC, model ASC`,
      [owner(ownerEmail), window.weekStart],
    );
    return costSummary(window, totals, models, labelFor);
  });
}
