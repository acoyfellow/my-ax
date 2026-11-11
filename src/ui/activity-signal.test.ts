import assert from "node:assert/strict";
import test from "node:test";
import { activitySignalLabel, activitySignalOf } from "./activity-signal";

test("connection problems outrank a running turn", () => {
  assert.equal(activitySignalOf("offline", "running"), "offline");
  assert.equal(activitySignalOf("reconnecting", "thinking"), "connecting");
});

test("a live connection shows running while a turn works and idle otherwise", () => {
  assert.equal(activitySignalOf("live", "thinking"), "running");
  assert.equal(activitySignalOf("live", "running"), "running");
  assert.equal(activitySignalOf("live", "done"), "idle");
  assert.equal(activitySignalOf("live", "idle"), "idle");
});

test("every signal has a spoken label because the mark has no text", () => {
  for (const signal of ["offline", "connecting", "running", "idle"] as const) assert.ok(activitySignalLabel(signal).length > 0);
});
