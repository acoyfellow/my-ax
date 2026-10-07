import assert from "node:assert/strict";
import test from "node:test";
import { judgeTurn, turnLimitsFromEnv, nextProgressSample, TURN_IDLE_LIMIT_MS, TURN_TOOL_LIMIT_MS, TurnProgressTracker } from "./turn-watchdog";

test("a turn that is not active is idle", () => {
  assert.equal(judgeTurn({ active: false, lastProgressAt: 0, toolsRunning: 0 }, 10 * TURN_TOOL_LIMIT_MS), "idle");
});

test("an active turn with no progress past the idle limit is stuck", () => {
  assert.equal(judgeTurn({ active: true, lastProgressAt: 0, toolsRunning: 0 }, TURN_IDLE_LIMIT_MS + 1), "stuck");
  assert.equal(judgeTurn({ active: true, lastProgressAt: 0, toolsRunning: 0 }, TURN_IDLE_LIMIT_MS - 1), "healthy");
});

test("a running tool gets the longer limit", () => {
  assert.equal(judgeTurn({ active: true, lastProgressAt: 0, toolsRunning: 1 }, TURN_IDLE_LIMIT_MS + 1), "healthy");
  assert.equal(judgeTurn({ active: true, lastProgressAt: 0, toolsRunning: 1 }, TURN_TOOL_LIMIT_MS + 1), "stuck");
});

test("the tracker records progress, tools and finish", () => {
  let now = 1_000;
  const tracker = new TurnProgressTracker(() => now);
  tracker.start();
  now = 2_000;
  tracker.toolStarted();
  assert.deepEqual(tracker.snapshot(), { active: true, lastProgressAt: 2_000, toolsRunning: 1 });
  now = 3_000;
  tracker.toolFinished();
  tracker.toolFinished();
  assert.deepEqual(tracker.snapshot(), { active: true, lastProgressAt: 3_000, toolsRunning: 0 });
  tracker.finish();
  assert.equal(tracker.snapshot().active, false);
});

test("a progress sample only moves when the signature changes", () => {
  const first = nextProgressSample(undefined, "a", 1);
  assert.deepEqual(nextProgressSample(first, "a", 5), { signature: "a", at: 1 });
  assert.deepEqual(nextProgressSample(first, "b", 5), { signature: "b", at: 5 });
});

test("an env override shortens both limits and bad values keep the defaults", () => {
  assert.deepEqual(turnLimitsFromEnv("30"), { idleMs: 30_000, toolMs: 30_000 });
  assert.deepEqual(turnLimitsFromEnv(undefined), { idleMs: TURN_IDLE_LIMIT_MS, toolMs: TURN_TOOL_LIMIT_MS });
  assert.deepEqual(turnLimitsFromEnv("nope"), { idleMs: TURN_IDLE_LIMIT_MS, toolMs: TURN_TOOL_LIMIT_MS });
});
