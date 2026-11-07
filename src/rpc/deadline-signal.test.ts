import assert from "node:assert/strict";
import test from "node:test";
import { deadlineSignal, settledWithin } from "./deadline-signal";

test("clearing the deadline leaves no pending timer behind", async () => {
  const pending = new Set<unknown>();
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  globalThis.setTimeout = ((fn: () => void, ms: number) => { const handle = realSet(fn, ms); pending.add(handle); return handle; }) as typeof setTimeout;
  globalThis.clearTimeout = ((handle: ReturnType<typeof setTimeout>) => { pending.delete(handle); realClear(handle); }) as typeof clearTimeout;
  try {
    const deadline = deadlineSignal(120_000);
    assert.equal(pending.size, 1);
    deadline.clear();
    assert.equal(pending.size, 0);
    assert.equal(deadline.signal.aborted, false);
  } finally {
    globalThis.setTimeout = realSet;
    globalThis.clearTimeout = realClear;
  }
});

test("the signal aborts with a TimeoutError when the deadline passes", async () => {
  const deadline = deadlineSignal(5);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(deadline.signal.aborted, true);
  assert.equal((deadline.signal.reason as DOMException).name, "TimeoutError");
});

test("a parent abort is forwarded, and clearing detaches from the parent", () => {
  const parent = new AbortController();
  const deadline = deadlineSignal(60_000, parent.signal);
  parent.abort("user stopped");
  assert.equal(deadline.signal.aborted, true);
  assert.equal(deadline.signal.reason, "user stopped");
  deadline.clear();
  const detached = deadlineSignal(60_000, new AbortController().signal);
  detached.clear();
  assert.equal(detached.signal.aborted, false);
});

test("settledWithin clears its timer when the work wins", async () => {
  const pending = new Set<unknown>();
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  globalThis.setTimeout = ((fn: () => void, ms: number) => { const handle = realSet(fn, ms); pending.add(handle); return handle; }) as typeof setTimeout;
  globalThis.clearTimeout = ((handle: ReturnType<typeof setTimeout>) => { pending.delete(handle); realClear(handle); }) as typeof clearTimeout;
  try {
    assert.equal(await settledWithin(Promise.resolve("done"), 800), true);
    assert.equal(pending.size, 0);
  } finally {
    globalThis.setTimeout = realSet;
    globalThis.clearTimeout = realClear;
  }
});

test("settledWithin reports false when the work is slower, and true for a rejection", async () => {
  assert.equal(await settledWithin(new Promise(() => undefined), 5), false);
  assert.equal(await settledWithin(Promise.reject(new Error("x")), 50), true);
});
