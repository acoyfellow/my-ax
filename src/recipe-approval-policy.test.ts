import test from "node:test";
import assert from "node:assert/strict";
import { recipeApprovalDecision, shouldPersistSuggestedRecipe } from "./recipe-approval-policy";

test("auto-trusted recipes do not create approval attention", () => {
  assert.deepEqual(recipeApprovalDecision({ autoTrust: true, capabilities: ["workspace.read"], portable: true }), {
    notify: false,
    reason: "auto_trust",
  });
});

test("auto-enable never bypasses the high-authority inline-only boundary", () => {
  assert.deepEqual(recipeApprovalDecision({ autoTrust: true, capabilities: ["machine.shell"], portable: false }), {
    notify: false,
    reason: "high_authority_inline_only",
  });
});

test("portable workspace recipes still ask for owner review when not auto-trusted", () => {
  assert.deepEqual(recipeApprovalDecision({ autoTrust: false, capabilities: ["workspace.read"], portable: true }), {
    notify: true,
    reason: "owner_review_required",
  });
});

test("non-portable machine recipes stay inline instead of creating attention noise", () => {
  const decision = recipeApprovalDecision({ autoTrust: false, capabilities: ["machine.shell"], portable: false });
  assert.deepEqual(decision, {
    notify: false,
    reason: "high_authority_inline_only",
  });
  assert.equal(shouldPersistSuggestedRecipe(decision), false);
});

test("terrarium recipes are also treated as high-authority inline-only prompts", () => {
  assert.deepEqual(recipeApprovalDecision({ autoTrust: false, capabilities: ["terrarium.spawn"], portable: false }), {
    notify: false,
    reason: "high_authority_inline_only",
  });
});

test("portable owner-reviewed recipes are still persisted for review", () => {
  const decision = recipeApprovalDecision({ autoTrust: false, capabilities: ["workspace.read"], portable: true });
  assert.equal(shouldPersistSuggestedRecipe(decision), true);
});
