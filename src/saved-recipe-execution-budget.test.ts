import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPUTER_WORK_CODE_MAX_CALLS,
  WORK_CODE_SAVED_RECIPE_MAX_INVOCATIONS,
  applyComputerWorkBudget,
  createWorkCodeExecutionState,
  reserveSavedRecipeInvocation,
} from "./computer-work-budget";
import { intersectCapabilities } from "./capability-intersect";
import { RecipeUsageCollector, RECIPES_USED_THIS_TURN_MAX_ENTRIES } from "./recipe-usage-collector";
import { capWorkCodeCollectionWithMetadata, WORK_CODE_CALLS_MAX_BYTES, WORK_CODE_CALLS_MAX_ENTRIES } from "./work-code-output";

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

test("one outer work_code execution bounds 1,000 saved recipe retries, receipts, usage, and Computer calls", async () => {
  const state = createWorkCodeExecutionState();
  const recipesUsed = new RecipeUsageCollector();
  const runReceipts: unknown[] = [];
  let savedRuns = 0;
  let providerCalls = 0;
  const outerComputer = applyComputerWorkBudget({
    list: async () => {
      providerCalls += 1;
      return "outer";
    },
  }, state);

  assert.equal(await outerComputer.list({}), "outer");

  async function runSavedRecipeFromOuterWorkCode() {
    reserveSavedRecipeInvocation(state);
    savedRuns += 1;
    const effectiveCapabilities = intersectCapabilities(["computer.list"], ["computer.list", "workspace.write"]);
    const nestedComputer = applyComputerWorkBudget({
      list: async () => {
        providerCalls += 1;
        return "nested";
      },
    }, state);
    let executionOk = true;
    try {
      assert.equal(effectiveCapabilities.includes("workspace.write"), false);
      assert.equal(await nestedComputer.list({}), "nested");
    } catch {
      executionOk = false;
    }
    recipesUsed.add({ recipeId: "saved", effectiveCapabilities, executionOk });
    runReceipts.push({ recipeId: "saved", effectiveCapabilities, executionOk });
  }

  for (let index = 0; index < 1_000; index += 1) {
    await runSavedRecipeFromOuterWorkCode().catch(() => undefined);
  }

  const serializedReceipts = capWorkCodeCollectionWithMetadata(runReceipts, WORK_CODE_CALLS_MAX_ENTRIES, WORK_CODE_CALLS_MAX_BYTES);
  const recordedUsage = recipesUsed.take();
  assert.equal(savedRuns, WORK_CODE_SAVED_RECIPE_MAX_INVOCATIONS);
  assert.equal(providerCalls, COMPUTER_WORK_CODE_MAX_CALLS);
  assert.ok(runReceipts.length <= WORK_CODE_SAVED_RECIPE_MAX_INVOCATIONS);
  assert.ok(serializedReceipts.values.length <= WORK_CODE_CALLS_MAX_ENTRIES);
  assert.ok(bytes(serializedReceipts.values) <= WORK_CODE_CALLS_MAX_BYTES);
  assert.equal(recordedUsage.length, RECIPES_USED_THIS_TURN_MAX_ENTRIES + 1);
  assert.deepEqual(recordedUsage.at(-1), { kind: "truncated", omitted: WORK_CODE_SAVED_RECIPE_MAX_INVOCATIONS - RECIPES_USED_THIS_TURN_MAX_ENTRIES });

  for (let index = 0; index < 1_000; index += 1) {
    await runSavedRecipeFromOuterWorkCode().catch(() => undefined);
  }

  assert.equal(savedRuns, WORK_CODE_SAVED_RECIPE_MAX_INVOCATIONS);
  assert.equal(providerCalls, COMPUTER_WORK_CODE_MAX_CALLS);
  assert.equal(runReceipts.length, WORK_CODE_SAVED_RECIPE_MAX_INVOCATIONS);
});
