import assert from "node:assert/strict";
import test from "node:test";
import { asAgentToolFailure, delegateManyInputSchema, delegateRunId, shouldRetryDelegate, taskFingerprint } from "./delegate-many";

test("fingerprint and run id are stable under insignificant whitespace", () => {
  assert.equal(taskFingerprint(" inspect   evidence "), taskFingerprint("inspect evidence"));
  assert.equal(delegateRunId("parent", "call-1", " inspect evidence", 0), delegateRunId("parent", "call-1", "inspect evidence", 0));
  assert.notEqual(delegateRunId("parent", "call-1", "inspect evidence", 0), delegateRunId("parent", "call-1", "inspect evidence", 1));
  assert.notEqual(delegateRunId("parent", "call-1", "inspect evidence", 0), delegateRunId("parent", "call-2", "inspect evidence", 0));
});

test("contract permits at most two typed tasks", () => {
  assert.equal(delegateManyInputSchema.parse({ tasks: [{ task: "a" }, { task: "b" }] }).tasks.length, 2);
  assert.throws(() => delegateManyInputSchema.parse({ tasks: [{ task: "a" }, { task: "b" }, { task: "c" }] }));
  assert.throws(() => delegateManyInputSchema.parse({ tasks: [] }));
});

test("only a stopped transient interruption receives one retry", () => {
  const interrupted = asAgentToolFailure({ runId: "r", agentType: "child", status: "interrupted", error: "deploy", childStillRunning: false });
  assert(interrupted);
  assert.equal(shouldRetryDelegate(interrupted, 1), true);
  assert.equal(shouldRetryDelegate(interrupted, 2), false);
  const running = { ...interrupted, childStillRunning: true };
  assert.equal(shouldRetryDelegate(running, 1), false);
  const error = asAgentToolFailure({ runId: "r", agentType: "child", status: "error", error: "bad input" });
  assert(error);
  assert.equal(error.retryable, false);
  assert.equal(shouldRetryDelegate(error, 1), false);
});
