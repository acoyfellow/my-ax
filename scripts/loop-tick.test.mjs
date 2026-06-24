import test from "node:test";
import assert from "node:assert/strict";
import { classifyTick } from "./loop-tick.mjs";

const base = {
  state: "idle", weeklyBetId: "walk-away-completion", lease: null,
  repository: { patchDigest: null }, budget: { searches: 0, writers: 0, deployments: 0 },
  circuit: { state: "closed", reason: null },
};

test("tick reconciles existing work and never creates work from a dirty unknown checkout", () => {
  assert.equal(classifyTick({ state: { ...base, state: "child_running" }, dirty: false, diffDigest: "x" }).action, "reconcile_current");
  assert.equal(classifyTick({ state: base, dirty: true, diffDigest: "x" }).action, "needs_operator_dirty_checkout");
  const owned = { ...base, state: "child_completed", repository: { patchDigest: "x" } };
  assert.equal(classifyTick({ state: owned, dirty: true, diffDigest: "x" }).action, "reconcile_current");
});

test("tick requires direction, budgets, a free lease, and a closed circuit", () => {
  assert.equal(classifyTick({ state: { ...base, weeklyBetId: null }, dirty: false, diffDigest: "x" }).action, "needs_direction");
  assert.equal(classifyTick({ state: { ...base, budget: { searches: 4, writers: 0, deployments: 0 } }, dirty: false, diffDigest: "x" }).action, "budget_exhausted");
  assert.equal(classifyTick({ state: { ...base, circuit: { state: "open", reason: "proof failed" } }, dirty: false, diffDigest: "x" }).action, "circuit_open");
  assert.equal(classifyTick({ state: { ...base, lease: { holder: "other", expiresAt: "2999-01-01T00:00:00.000Z" } }, dirty: false, diffDigest: "x" }).action, "wait_for_lease");
  assert.equal(classifyTick({ state: base, dirty: false, diffDigest: "x" }).action, "eligible_to_select");
});
