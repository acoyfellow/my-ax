import assert from "node:assert/strict";
import test from "node:test";
import type { AgentToolFailure } from "agents/agent-tools";
import { delegateRunId, shouldRetryDelegate, taskFingerprint } from "./delegate-serial";

// delegateManyInputSchema lives in delegate-many.ts (which imports Think and so
// can't load under plain tsx); the input contract is re-validated indirectly by
// the serial tests. The pure helpers below come from delegate-serial.ts.
function asAgentToolFailure(result: { status: string; error?: string; childStillRunning?: boolean; runId?: string; agentType?: string }): AgentToolFailure | undefined {
  if (result.status === "completed") return undefined;
  return { ok: false, status: result.status, error: result.error ?? `Delegate ended with ${result.status}`, retryable: result.status === "interrupted", ...(result.status === "interrupted" ? { childStillRunning: result.childStillRunning } : {}) } as AgentToolFailure;
}

test("fingerprint and run id are stable under insignificant whitespace", () => {
  assert.equal(taskFingerprint(" inspect   evidence "), taskFingerprint("inspect evidence"));
  assert.equal(delegateRunId("parent", "call-1", " inspect evidence", 0), delegateRunId("parent", "call-1", "inspect evidence", 0));
  assert.notEqual(delegateRunId("parent", "call-1", "inspect evidence", 0), delegateRunId("parent", "call-1", "inspect evidence", 1));
  assert.notEqual(delegateRunId("parent", "call-1", "inspect evidence", 0), delegateRunId("parent", "call-2", "inspect evidence", 0));
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
