import assert from "node:assert/strict";
import test from "node:test";
import { sessionSignalLabel, sessionSignalOf } from "./session-signal";

test("a running or thinking turn shows the running signal", () => {
  assert.equal(sessionSignalOf("running"), "running");
  assert.equal(sessionSignalOf("Thinking"), "running");
});

test("a failed turn shows the error signal and anything else is idle", () => {
  assert.equal(sessionSignalOf("failed"), "error");
  assert.equal(sessionSignalOf("error"), "error");
  assert.equal(sessionSignalOf("done"), "idle");
  assert.equal(sessionSignalOf(null), "idle");
  assert.equal(sessionSignalLabel("error"), "Last turn failed");
});
