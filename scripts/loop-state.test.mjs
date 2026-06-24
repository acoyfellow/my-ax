import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "loop-state.mjs");
function run(cwd, ...args) { return execFileSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" }).trim(); }

test("loop state enforces generation, lease ownership, legal transitions, budgets, and monotonic fencing", () => {
  const cwd = mkdtempSync(join(tmpdir(), "my-ax-loop-state-"));
  try {
    mkdirSync(join(cwd, ".git"));
    const initial = JSON.parse(run(cwd, "init"));
    assert.equal(initial.state, "idle");
    assert.equal(initial.generation, 1);
    const lease = JSON.parse(run(cwd, "acquire", "controller-a", "reconcile", "60"));
    assert.equal(lease.holder, "controller-a");
    assert.equal(lease.fencingToken, 1);
    const state = JSON.parse(run(cwd, "status"));
    assert.equal(state.generation, 2);
    assert.equal(JSON.parse(run(cwd, "transition", "2", "idle", "selecting", "weekly candidate", "controller-a")).state, "selecting");
    assert.equal(JSON.parse(run(cwd, "status")).budget.searches, 1);
    const stale = spawnSync(process.execPath, [script, "transition", "2", "selecting", "child_running"], { cwd, encoding: "utf8" });
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /stale generation/);
    const illegal = spawnSync(process.execPath, [script, "transition", "3", "selecting", "deploying"], { cwd, encoding: "utf8" });
    assert.notEqual(illegal.status, 0);
    assert.match(illegal.stderr, /illegal transition/);
    const other = spawnSync(process.execPath, [script, "release", "controller-b", lease.id], { cwd, encoding: "utf8" });
    assert.notEqual(other.status, 0);
    assert.match(other.stderr, /not held by caller/);
    const beat = JSON.parse(run(cwd, "heartbeat", "controller-a", lease.id, "120"));
    assert.equal(beat.id, lease.id);
    assert.equal(run(cwd, "release", "controller-a", lease.id), "released");
    const second = JSON.parse(run(cwd, "acquire", "controller-a", "reconcile", "60"));
    assert.equal(second.fencingToken, 2);
    const beforeBet = JSON.parse(run(cwd, "status"));
    assert.equal(JSON.parse(run(cwd, "set-bet", String(beforeBet.generation), "walk-away-completion")).weeklyBetId, "walk-away-completion");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("loop state recovers an abandoned short critical-section lock and archives terminal work", () => {
  const cwd = mkdtempSync(join(tmpdir(), "my-ax-loop-lock-"));
  try {
    mkdirSync(join(cwd, ".git"));
    run(cwd, "init");
    const lock = join(cwd, ".my-ax-loop", "state.lock");
    mkdirSync(lock);
    const old = new Date(Date.now() - 60_000); utimesSync(lock, old, old);
    assert.equal(JSON.parse(run(cwd, "acquire", "controller", "reconcile", "60")).holder, "controller");
    const path = join(cwd, ".my-ax-loop", "state.json");
    const state = JSON.parse(readFileSync(path, "utf8"));
    state.state = "complete"; state.generation += 1; writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
    assert.equal(JSON.parse(run(cwd, "archive", String(state.generation))).state, "idle");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
