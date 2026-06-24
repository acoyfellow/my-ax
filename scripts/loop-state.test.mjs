import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "loop-state.mjs");
function run(cwd, ...args) { return execFileSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" }).trim(); }
function fail(cwd, ...args) { return spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" }); }
const outcome = JSON.stringify({
  findingId: "USER-OUTCOME-001", user: "operator", journey: "walk away and return to a completed task",
  observedProblem: "completion is not discoverable", expectedChange: "completion is visible with a next action",
  productionMeasure: "authenticated journey shows one actionable receipt", discovery: "attention",
});

test("loop state enforces generation, lease ownership, legal transitions, budgets, and monotonic fencing", () => {
  const cwd = mkdtempSync(join(tmpdir(), "my-ax-loop-state-"));
  try {
    mkdirSync(join(cwd, ".git"));
    const initial = JSON.parse(run(cwd, "init"));
    assert.equal(initial.state, "idle");
    const lease = JSON.parse(run(cwd, "acquire", "controller-a", "reconcile", "60"));
    assert.equal(lease.fencingToken, 1);
    assert.equal(JSON.parse(run(cwd, "transition", "2", "idle", "selecting", "weekly candidate", "controller-a")).state, "selecting");
    assert.equal(JSON.parse(run(cwd, "status")).budget.searches, 1);
    const stale = fail(cwd, "transition", "2", "selecting", "child_running");
    assert.notEqual(stale.status, 0); assert.match(stale.stderr, /stale generation/);
    const gated = fail(cwd, "transition", "3", "selecting", "child_running");
    assert.notEqual(gated.status, 0); assert.match(gated.stderr, /user outcome gate/);
    assert.equal(JSON.parse(run(cwd, "set-outcome", "3", outcome)).userOutcome.findingId, "USER-OUTCOME-001");
    assert.equal(JSON.parse(run(cwd, "transition", "4", "selecting", "child_running")).state, "child_running");
    const illegal = fail(cwd, "transition", "5", "child_running", "deploying");
    assert.notEqual(illegal.status, 0); assert.match(illegal.stderr, /illegal transition/);
    const other = fail(cwd, "release", "controller-b", lease.id);
    assert.notEqual(other.status, 0); assert.match(other.stderr, /not held by caller/);
    const beat = JSON.parse(run(cwd, "heartbeat", "controller-a", lease.id, "120"));
    assert.equal(beat.id, lease.id);
    assert.equal(run(cwd, "release", "controller-a", lease.id), "released");
    const second = JSON.parse(run(cwd, "acquire", "controller-a", "reconcile", "60"));
    assert.equal(second.fencingToken, 2);
    const beforeBet = JSON.parse(run(cwd, "status"));
    assert.equal(JSON.parse(run(cwd, "set-bet", String(beforeBet.generation), "walk-away-completion")).weeklyBetId, "walk-away-completion");
    const beforeApproval = JSON.parse(run(cwd, "status"));
    assert.equal(JSON.parse(run(cwd, "approve-release", String(beforeApproval.generation), "2", "operator continue")).deploymentLimit, 2);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("changed completion requires production proof and a user-facing release summary", () => {
  const cwd = mkdtempSync(join(tmpdir(), "my-ax-loop-gates-"));
  try {
    mkdirSync(join(cwd, ".git")); run(cwd, "init"); const lease = JSON.parse(run(cwd, "acquire", "controller", "reconcile", "60"));
    const path = join(cwd, ".my-ax-loop", "state.json");
    const state = JSON.parse(readFileSync(path, "utf8")); state.state = "proving"; state.userOutcome = JSON.parse(outcome); state.generation += 1; writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
    const noProof = fail(cwd, "transition", String(state.generation), "proving", "production_certified");
    assert.match(noProof.stderr, /production proof record required/);
    const recorded = JSON.parse(run(cwd, "set-proof", String(state.generation), JSON.stringify({ deploymentRevision: "abc123", measure: "one receipt", result: "passed" })));
    assert.equal(recorded.proof.result, "passed");
    const certified = JSON.parse(run(cwd, "transition", String(recorded.generation), "proving", "production_certified"));
    const noSummary = fail(cwd, "transition", String(certified.generation), "production_certified", "complete");
    assert.match(noSummary.stderr, /release summary required/);
    const summary = JSON.parse(run(cwd, "set-release-summary", String(certified.generation), JSON.stringify({ title: "Completion is visible", benefit: "You can see what finished", action: "No action required", visibility: "whats-new" })));
    assert.equal(summary.releaseSummary.visibility, "whats-new");
    assert.equal(JSON.parse(run(cwd, "transition", String(summary.generation), "production_certified", "complete")).state, "complete");
    run(cwd, "release", "controller", lease.id);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("loop state recovers an abandoned short critical-section lock and archives terminal work", () => {
  const cwd = mkdtempSync(join(tmpdir(), "my-ax-loop-lock-"));
  try {
    mkdirSync(join(cwd, ".git")); run(cwd, "init");
    const lock = join(cwd, ".my-ax-loop", "state.lock"); mkdirSync(lock); const old = new Date(Date.now() - 60_000); utimesSync(lock, old, old);
    assert.equal(JSON.parse(run(cwd, "acquire", "controller", "reconcile", "60")).holder, "controller");
    const path = join(cwd, ".my-ax-loop", "state.json"); const state = JSON.parse(readFileSync(path, "utf8"));
    state.state = "complete"; state.generation += 1; writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
    assert.equal(JSON.parse(run(cwd, "archive", String(state.generation))).state, "idle");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
