import assert from "node:assert/strict";
import test from "node:test";
import { requireRecipeTransition } from "./fsm/recipe-status";
import { SAVED_RECIPE_STATUSES, validateSavedRecipeInput, validateSavedRecipePatch } from "./saved-recipes";

test("saved recipes include pending for owner-gated promotions", () => {
  assert.deepEqual(SAVED_RECIPE_STATUSES, ["pending", "enabled", "disabled"]);
  const parsed = validateSavedRecipeInput({
    name: "PendingRecipe",
    description: "Pending recipe for owner approval.",
    inputSchema: { type: "object", properties: {} },
    code: "return input;",
    capabilities: ["workspace.read"],
    status: "pending",
  });
  assert.equal(parsed.status, "pending");
});

test("saved recipe approval patch accepts pending to enabled and reject to disabled", () => {
  assert.equal(validateSavedRecipePatch({ status: "enabled" }).statusEvent, "enabled");
  assert.equal(validateSavedRecipePatch({ status: "disabled" }).statusEvent, "disabled");
  assert.equal(validateSavedRecipePatch({ status: "pending" }).statusEvent, "returned_to_review");
  assert.throws(() => validateSavedRecipePatch({ status: "other" }), /pending, enabled, or disabled/);
});

test("a pending recipe cannot be switched on without the approval step", () => {
  assert.throws(() => requireRecipeTransition("pending", "enabled"), /must be approved/);
  assert.equal(requireRecipeTransition("pending", "approved"), "enabled");
});
