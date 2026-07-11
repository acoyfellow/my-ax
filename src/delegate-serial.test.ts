import assert from "node:assert/strict";
import test from "node:test";
import type { AgentToolFailure } from "agents/agent-tools";
import {
  delegateResultSchema,
  delegateRunId,
  isRateLimitFailure,
  runDelegatesSerially,
  shouldRetryDelegate,
  shouldRetryDelegateAttempt,
  taskFingerprint,
  type DelegateTaskOutcome,
} from "./delegate-serial";

const RATE_LIMIT_MSG = "3021: rate limiting: inference request per min rate reached";

function failureFor(status: "error" | "aborted" | "interrupted", error?: string, childStillRunning = false): AgentToolFailure {
  return {
    ok: false,
    status,
    error: error ?? `Delegate ended with ${status}`,
    retryable: status === "interrupted",
    ...(status === "interrupted" ? { childStillRunning } : {}),
  } as AgentToolFailure;
}
function outcome(status: DelegateTaskOutcome["status"], over: Partial<DelegateTaskOutcome> = {}): DelegateTaskOutcome {
  const failure = status === "completed" ? undefined : failureFor(status as any, over.error);
  return { runId: over.runId ?? "r", status, summary: over.summary, output: over.output, error: over.error, failure };
}
// Records launch order so we can prove serial execution + no second launch after 3021.
function launcher(script: (index: number, launchNo: number) => DelegateTaskOutcome) {
  const launches: number[] = [];
  const runTask = async (index: number) => { launches.push(index); return script(index, launches.length); };
  return { runTask, launches };
}

test("fingerprint and run id are stable under insignificant whitespace", () => {
  assert.equal(taskFingerprint(" inspect   evidence "), taskFingerprint("inspect evidence"));
  assert.equal(delegateRunId("parent", "call-1", " inspect evidence", 0), delegateRunId("parent", "call-1", "inspect evidence", 0));
  assert.notEqual(delegateRunId("parent", "call-1", "inspect evidence", 0), delegateRunId("parent", "call-1", "inspect evidence", 1));
  assert.notEqual(delegateRunId("parent", "call-1", "inspect evidence", 0), delegateRunId("parent", "call-2", "inspect evidence", 0));
});

test("isRateLimitFailure detects a thrown 3021 error-status failure (not an interruption)", () => {
  assert.equal(isRateLimitFailure(failureFor("error", RATE_LIMIT_MSG)), true);
  assert.equal(isRateLimitFailure(failureFor("error", "bad input")), false);
  assert.equal(isRateLimitFailure(undefined), false);
});

test("a 3021 is backpressure: shouldRetryDelegateAttempt NEVER retries it in-call", () => {
  const rl = failureFor("error", RATE_LIMIT_MSG);
  assert.equal(shouldRetryDelegateAttempt(rl, 1), false, "no same-call retry against a per-minute cap");
  assert.equal(shouldRetryDelegateAttempt(rl, 2), false);
  // A stopped interruption still gets its single existing retry.
  const interrupted = failureFor("interrupted", "deploy", false);
  assert.equal(shouldRetryDelegate(interrupted, 1), true);
  assert.equal(shouldRetryDelegateAttempt(interrupted, 1), true);
  assert.equal(shouldRetryDelegateAttempt(interrupted, 2), false);
  assert.equal(shouldRetryDelegateAttempt(undefined, 1), false);
});

test("two clean tasks run SERIALLY, in order", async () => {
  const { runTask, launches } = launcher(() => outcome("completed", { summary: "ok" }));
  const results = await runDelegatesSerially([{ task: "a" }, { task: "b" }], runTask);
  assert.deepEqual(launches, [0, 1], "one at a time, in order");
  assert.equal(results.length, 2);
  assert.equal(results[0].status, "completed");
  assert.equal(results[1].status, "completed");
});

test("3021 on task 0: zero same-call retry AND the second delegate is NEVER launched", async () => {
  let runsForZero = 0;
  const { runTask, launches } = launcher((index) => {
    if (index === 0) { runsForZero++; return outcome("error", { error: RATE_LIMIT_MSG }); }
    return outcome("completed", { summary: "should never run" });
  });
  const results = await runDelegatesSerially([{ task: "a" }, { task: "b" }], runTask);
  assert.equal(runsForZero, 1, "task 0 launched exactly once — no same-call 3021 retry");
  assert.deepEqual(launches, [0], "task 1 was NEVER launched (fan-out stopped)");
  assert.equal(results[0].status, "error", "truthful failed status retained for task 0");
  assert.ok(results[0].error?.includes("3021"), "error text carried for UX/receipt");
  assert.equal(results[0].attempts, 1);
  assert.equal(results[1].status, "deferred", "task 1 marked deferred (backpressure), not failed");
  assert.equal(results[1].attempts, 0, "deferred task was never attempted");
  assert.ok(results[1].error?.toLowerCase().includes("defer"));
});

test("deferred + real results are schema-valid; deferred runId is a distinct non-evidence id", async () => {
  const { runTask } = launcher((index) => index === 0 ? outcome("error", { error: RATE_LIMIT_MSG }) : outcome("completed"));
  const results = await runDelegatesSerially([{ task: "a" }, { task: "b" }], runTask);
  for (const r of results) delegateResultSchema.parse(r); // throws if the contract is violated
  assert.match(results[1].runId, /^delegate:deferred:/, "deferred runId cannot masquerade as real evidence");
});

test("a stopped interruption on task 0 still retries once, then task 1 runs normally", async () => {
  const { runTask, launches } = launcher((index, launchNo) => {
    if (index === 0) return launchNo === 1 ? outcome("interrupted", { error: "deploy" }) : outcome("completed", { summary: "recovered" });
    return outcome("completed", { summary: "ok" });
  });
  const results = await runDelegatesSerially([{ task: "a" }, { task: "b" }], runTask);
  assert.deepEqual(launches, [0, 0, 1], "task 0 retried once; task 1 still runs after a non-rate-limit recovery");
  assert.equal(results[0].attempts, 2);
  assert.equal(results[0].status, "completed");
  assert.equal(results[1].status, "completed");
});

test("single-task 3021: truthful error, one attempt, nothing to defer", async () => {
  const { runTask, launches } = launcher(() => outcome("error", { error: RATE_LIMIT_MSG }));
  const results = await runDelegatesSerially([{ task: "only" }], runTask);
  assert.deepEqual(launches, [0]);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "error");
  assert.equal(results[0].attempts, 1, "no same-call retry");
});

test("non-rate-limit error on task 0 does NOT defer task 1 (only 3021 is backpressure)", async () => {
  const { runTask, launches } = launcher((index) => index === 0 ? outcome("error", { error: "bad input" }) : outcome("completed", { summary: "ok" }));
  const results = await runDelegatesSerially([{ task: "a" }, { task: "b" }], runTask);
  assert.deepEqual(launches, [0, 1], "a plain error is not backpressure; task 1 still launches");
  assert.equal(results[0].status, "error");
  assert.equal(results[1].status, "completed");
});
