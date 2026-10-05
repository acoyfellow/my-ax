import assert from "node:assert/strict";
import test from "node:test";
import type { AgentToolFailure } from "agents/agent-tools";
import {
  delegateResultSchema,
  delegateRunId,
  isRateLimitFailure,
  runDelegatesInParallel,
  DELEGATE_MANY_LIMIT,
  DELEGATE_INITIAL_CONCURRENCY,
  shouldRetryDelegate,
  shouldRetryDelegateAttempt,
  taskFingerprint,
  collectOpenAiStoredItemIds,
  stripOpenAiStoredItemRefs,
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
function launcher(script: (index: number, launchNo: number) => DelegateTaskOutcome) {
  const launches: number[] = [];
  const runTask = async (index: number) => { launches.push(index); return script(index, launches.length); };
  return { runTask, launches };
}

test("child input must not carry prior OpenAI stored item ids under ZDR", () => {
  const leaked = {
    role: "assistant",
    content: [{
      type: "text",
      text: "prior child",
      providerOptions: { openai: { itemId: "rs_abc123" } },
      providerMetadata: { openai: { itemId: "rs_abc123" } },
    }],
  };
  assert.deepEqual(collectOpenAiStoredItemIds(leaked), ["rs_abc123"]);
  const selfContained = stripOpenAiStoredItemRefs(leaked);
  assert.deepEqual(collectOpenAiStoredItemIds(selfContained), []);
  assert.equal((selfContained as typeof leaked).content[0].text, "prior child");
});

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

  // Unknown liveness (childStillRunning undefined) must NOT retry: a
  // still-running child would be duplicated.
  const unknownLiveness = { ok: false, status: "interrupted", error: "deploy", retryable: true } as AgentToolFailure;
  assert.equal(shouldRetryDelegate(unknownLiveness, 1), false);
  // Explicitly-still-running also never retries.
  const stillRunning = failureFor("interrupted", "deploy", true);
  assert.equal(shouldRetryDelegate(stillRunning, 1), false);
  assert.equal(shouldRetryDelegateAttempt(undefined, 1), false);
});

const noWait = async () => {};

function concurrencyProbe(script: (index: number, attempt: number) => DelegateTaskOutcome) {
  let active = 0;
  let peak = 0;
  const attempts = new Map<number, number>();
  const launches: number[] = [];
  const runTask = async (index: number) => {
    const attempt = (attempts.get(index) ?? 0) + 1;
    attempts.set(index, attempt);
    launches.push(index);
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setImmediate(resolve));
    active--;
    return script(index, attempt);
  };
  return { runTask, launches, peak: () => peak };
}

test("the batch limit is 1000 tasks", () => {
  assert.equal(DELEGATE_MANY_LIMIT, 1000);
});

test("independent tasks start together instead of one after the other", async () => {
  const probe = concurrencyProbe(() => outcome("completed", { summary: "ok" }));
  const tasks = Array.from({ length: 16 }, (_, i) => ({ task: `t${i}` }));
  const results = await runDelegatesInParallel(tasks, probe.runTask, { backoff: noWait });
  assert.equal(probe.peak(), 16);
  assert.equal(results.length, 16);
  assert.ok(results.every((r) => r.status === "completed"));
});

test("results keep input order even when tasks finish out of order", async () => {
  const runTask = async (index: number) => {
    await new Promise((resolve) => setTimeout(resolve, (5 - index) * 2));
    return outcome("completed", { runId: `r${index}`, summary: `s${index}` });
  };
  const results = await runDelegatesInParallel(Array.from({ length: 5 }, (_, i) => ({ task: `t${i}` })), runTask, { backoff: noWait });
  assert.deepEqual(results.map((r) => r.runId), ["r0", "r1", "r2", "r3", "r4"]);
});

test("the concurrency window caps active children for a 1000-task batch", async () => {
  const probe = concurrencyProbe(() => outcome("completed"));
  const tasks = Array.from({ length: DELEGATE_MANY_LIMIT }, (_, i) => ({ task: `t${i}` }));
  const results = await runDelegatesInParallel(tasks, probe.runTask, { backoff: noWait });
  assert.equal(results.length, 1000);
  assert.ok(probe.peak() <= DELEGATE_INITIAL_CONCURRENCY);
  assert.equal(probe.peak(), DELEGATE_INITIAL_CONCURRENCY);
});

test("a 3021 backs off and re-admits the same task instead of deferring the batch", async () => {
  let backoffs = 0;
  const probe = concurrencyProbe((index, attempt) => (index === 0 && attempt === 1 ? outcome("error", { error: RATE_LIMIT_MSG }) : outcome("completed", { summary: "ok" })));
  const results = await runDelegatesInParallel([{ task: "a" }, { task: "b" }], probe.runTask, { backoff: async () => { backoffs++; } });
  assert.equal(backoffs, 1);
  assert.equal(results[0].status, "completed");
  assert.equal(results[0].attempts, 2);
  assert.equal(results[1].status, "completed");
});

test("3021 detected via the error channel alone still triggers backoff and retry", async () => {
  let backoffs = 0;
  const runTask = async (index: number) => (index === 0 && backoffs === 0
    ? ({ runId: "r0", status: "error", error: RATE_LIMIT_MSG, failure: undefined } as DelegateTaskOutcome)
    : outcome("completed"));
  const results = await runDelegatesInParallel([{ task: "a" }, { task: "b" }], runTask, { backoff: async () => { backoffs++; } });
  assert.equal(backoffs, 1);
  assert.equal(results[0].status, "completed");
});

test("rate-limit pressure narrows the window for retries", async () => {
  const attempts = new Map<number, number>();
  let active = 0;
  let firstWavePeak = 0;
  let retryPeak = 0;
  const runTask = async (index: number) => {
    const attempt = (attempts.get(index) ?? 0) + 1;
    attempts.set(index, attempt);
    active++;
    if (attempt === 1) firstWavePeak = Math.max(firstWavePeak, active); else retryPeak = Math.max(retryPeak, active);
    await new Promise((resolve) => setImmediate(resolve));
    active--;
    return attempt === 1 ? outcome("error", { error: RATE_LIMIT_MSG }) : outcome("completed");
  };
  const results = await runDelegatesInParallel(Array.from({ length: 8 }, (_, i) => ({ task: `t${i}` })), runTask, { backoff: noWait, initialConcurrency: 8 });
  assert.ok(results.every((r) => r.status === "completed" && r.attempts === 2));
  assert.equal(firstWavePeak, 8);
  assert.ok(retryPeak < firstWavePeak, `retry peak ${retryPeak} should be below first wave ${firstWavePeak}`);
});

test("a task is deferred only after its rate-limit retries are exhausted", async () => {
  const probe = concurrencyProbe(() => outcome("error", { error: RATE_LIMIT_MSG }));
  const results = await runDelegatesInParallel([{ task: "only" }], probe.runTask, { backoff: noWait, rateLimitRetries: 2 });
  assert.equal(results[0].status, "deferred");
  assert.equal(results[0].attempts, 3);
  assert.match(results[0].runId, /^delegate:deferred:/);
  delegateResultSchema.parse(results[0]);
});

test("the deadline defers tasks that have not started", async () => {
  const probe = concurrencyProbe(() => outcome("completed"));
  const results = await runDelegatesInParallel([{ task: "a" }, { task: "b" }], probe.runTask, { backoff: noWait, deadline: () => true });
  assert.deepEqual(probe.launches, []);
  assert.ok(results.every((r) => r.status === "deferred" && r.attempts === 0));
});

test("a stopped interruption still retries once", async () => {
  const probe = concurrencyProbe((index, attempt) => (index === 0 && attempt === 1 ? outcome("interrupted", { error: "deploy" }) : outcome("completed", { summary: "recovered" })));
  const results = await runDelegatesInParallel([{ task: "a" }, { task: "b" }], probe.runTask, { backoff: noWait });
  assert.equal(results[0].attempts, 2);
  assert.equal(results[0].status, "completed");
  assert.equal(results[1].status, "completed");
});

test("a non-rate-limit error is reported and does not affect sibling tasks", async () => {
  const probe = concurrencyProbe((index) => (index === 0 ? outcome("error", { error: "bad input" }) : outcome("completed")));
  const results = await runDelegatesInParallel([{ task: "a" }, { task: "b" }], probe.runTask, { backoff: noWait });
  assert.equal(results[0].status, "error");
  assert.equal(results[0].attempts, 1);
  assert.equal(results[1].status, "completed");
});
