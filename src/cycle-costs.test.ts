import assert from "node:assert/strict";
import test from "node:test";
import { nextCycleIndex, readCycleCostSeries, recordCycleCost } from "./cycle-costs";

function memoryEnv() {
  const rows: any[] = [];
  return {
    DB: {
      prepare(sql: string) {
        return {
          values: [] as unknown[],
          bind(...values: unknown[]) { this.values = values; return this; },
          async run() {
            if (sql.startsWith("INSERT INTO cycle_costs")) {
              const [id, owner_email, session_or_run_id, cycle_index, ts, model, finish_reason, input_tokens, output_tokens, total_tokens, usage_basis, recipes_used_json, recipes_saved_json] = this.values;
              rows.push({ id, owner_email, session_or_run_id, cycle_index, ts, model, finish_reason, input_tokens, output_tokens, total_tokens, usage_basis, recipes_used_json, recipes_saved_json });
            }
            return { success: true };
          },
          async first() {
            const [owner, session] = this.values;
            const matching = rows.filter((row) => row.owner_email === owner && row.session_or_run_id === session);
            return { next: matching.length ? Math.max(...matching.map((row) => row.cycle_index)) + 1 : 0 };
          },
          async all() {
            const [owner, session] = this.values;
            return { results: rows.filter((row) => row.owner_email === owner && row.session_or_run_id === session).sort((a, b) => a.cycle_index - b.cycle_index) };
          },
        };
      },
    },
    rows,
  } as any;
}

test("cost capture writes real usage fields and recipe annotations", async () => {
  const env = memoryEnv();
  await recordCycleCost(env, {
    ownerEmail: "Owner@Example.com",
    sessionOrRunId: "s1",
    cycleIndex: await nextCycleIndex(env, "owner@example.com", "s1"),
    ts: "2026-06-29T00:00:00.000Z",
    model: "m-real",
    finishReason: "stop",
    usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17, basis: "ai_sdk_step_usage" },
    recipesUsed: [{ recipeId: "r1", name: "reuse" }],
    recipesSaved: [],
  });
  assert.equal(env.rows[0].owner_email, "owner@example.com");
  assert.equal(env.rows[0].input_tokens, 12);
  assert.equal(env.rows[0].output_tokens, 5);
  assert.equal(env.rows[0].total_tokens, 17);
  assert.equal(env.rows[0].usage_basis, "ai_sdk_step_usage");
  assert.deepEqual(JSON.parse(env.rows[0].recipes_used_json), [{ recipeId: "r1", name: "reuse" }]);
});

test("read path returns owner-scoped series and never cross-owner", async () => {
  const env = memoryEnv();
  await recordCycleCost(env, { ownerEmail: "a@example.com", sessionOrRunId: "s1", cycleIndex: 0, usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, basis: "ai_sdk_step_usage" } });
  await recordCycleCost(env, { ownerEmail: "b@example.com", sessionOrRunId: "s1", cycleIndex: 0, usage: { inputTokens: 9, outputTokens: 9, totalTokens: 18, basis: "ai_sdk_step_usage" } });
  const aSeries = await readCycleCostSeries(env, "a@example.com", "s1");
  assert.equal(aSeries.length, 1);
  assert.equal(aSeries[0].totalTokens, 3);
  assert.equal((await readCycleCostSeries(env, "a@example.com", "missing")).length, 0);
});
