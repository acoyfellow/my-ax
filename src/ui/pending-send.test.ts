import assert from "node:assert/strict";
import test from "node:test";
import { createPendingSendQueue, PENDING_SEND_TIMEOUT_MS } from "./pending-send";

function fakeClock() {
  let now = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  let next = 1;
  return {
    schedule(run: () => void, delayMs: number) { const id = next++; timers.set(id, { at: now + delayMs, run }); return id; },
    cancel(handle: unknown) { timers.delete(handle as number); },
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.run(); }
    },
  };
}

test("a send during reconnect is delivered exactly once on open", () => {
  const clock = fakeClock();
  const timeouts: string[] = [];
  const queue = createPendingSendQueue<string>(clock);
  queue.enqueue("u-1", "hello", () => timeouts.push("u-1"));
  queue.enqueue("u-1", "hello", () => timeouts.push("u-1"));
  const delivered: string[] = [];
  queue.flush((payload) => delivered.push(payload));
  queue.flush((payload) => delivered.push(payload));
  clock.advance(PENDING_SEND_TIMEOUT_MS + 1);
  assert.deepEqual(delivered, ["hello"]);
  assert.deepEqual(timeouts, []);
  assert.equal(queue.size(), 0);
});

test("still closed after the timeout keeps the draft and reports the error once", () => {
  const clock = fakeClock();
  const timeouts: string[] = [];
  const queue = createPendingSendQueue<string>(clock);
  queue.enqueue("u-2", "draft", () => timeouts.push("u-2"));
  clock.advance(PENDING_SEND_TIMEOUT_MS - 1);
  assert.deepEqual(timeouts, []);
  clock.advance(1);
  assert.deepEqual(timeouts, ["u-2"]);
  const delivered: string[] = [];
  queue.flush((payload) => delivered.push(payload));
  assert.deepEqual(delivered, []);
});

test("timeout is bounded to 15 seconds", () => {
  assert.equal(PENDING_SEND_TIMEOUT_MS, 15_000);
});
