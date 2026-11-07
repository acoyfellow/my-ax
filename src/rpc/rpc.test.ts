import { test } from "node:test";
import assert from "node:assert/strict";
import { withTimeout } from "./timeout";
import { withRetry } from "./retry";

const quiet = () => { const o = console.log; console.log = () => {}; return () => { console.log = o; }; };
const sleep = (ms: number, v?: unknown) => new Promise((r) => setTimeout(() => r(v), ms));
const fail = (ms: number, e: unknown) => new Promise((_, rej) => setTimeout(() => rej(e), ms));

test("withTimeout: resolves in time", async () => {
  const restore = quiet();
  assert.deepEqual(await withTimeout({ promise: sleep(10, 42), timeoutMs: 100, op: "t" }), { ok: true, value: 42 });
  restore();
});
test("withTimeout: undefined result is ok, not a timeout", async () => {
  const restore = quiet();
  assert.deepEqual(await withTimeout({ promise: sleep(10, undefined), timeoutMs: 100, op: "t" }), { ok: true, value: undefined });
  restore();
});
test("withTimeout: times out, and the late value/rejection is ignored", async () => {
  const restore = quiet();
  const t0 = Date.now();
  const r = await withTimeout({ promise: fail(200, new Error("late")), timeoutMs: 50, op: "t" });
  assert.deepEqual(r, { ok: false, reason: "timeout" });
  assert.ok(Date.now() - t0 < 150);
  await sleep(200);
  restore();
});
test("withTimeout: error before timeout", async () => {
  const restore = quiet();
  const r = await withTimeout({ promise: fail(10, "boom"), timeoutMs: 100, op: "t" });
  assert.deepEqual(r, { ok: false, reason: "error", error: "boom" });
  restore();
});
test("withTimeout: logs one line with the op", async () => {
  const lines: string[] = []; const o = console.log; console.log = (s: string) => lines.push(s);
  await withTimeout({ promise: sleep(1, 1), timeoutMs: 100, op: "X.y" });
  console.log = o;
  assert.equal(lines.length, 1);
  const j = JSON.parse(lines[0]!);
  assert.equal(j.ev, "rpc.call"); assert.equal(j.op, "X.y"); assert.equal(j.outcome, "ok"); assert.equal(j.timeoutMs, 100);
});

const retryable = (msg: string) => Object.assign(new Error(msg), { retryable: true });
const overloaded = (msg: string) => Object.assign(new Error(msg), { retryable: true, overloaded: true });

test("withRetry: retries retryable errors, then succeeds; one line per failure + summary", async () => {
  const lines: string[] = []; const o = console.log; console.log = (s: string) => lines.push(s);
  let n = 0;
  const r = await withRetry({ start: () => (++n < 3 ? fail(1, retryable("x")) : sleep(1, "v")), op: "op", timeoutMs: 100, baseBackoffMs: 1, random: () => 0.5 });
  console.log = o;
  assert.equal(r.ok, true); assert.equal(n, 3); assert.equal(r.attempts.length, 3);
  assert.deepEqual(r.attempts.map((a) => a.outcome), ["error", "error", "ok"]);
  const evs = lines.map((l) => JSON.parse(l).ev);
  assert.deepEqual(evs, ["rpc.call", "rpc.attempt", "rpc.call", "rpc.attempt", "rpc.call", "rpc.retry"]);
});
test("withRetry: does not retry overloaded", async () => {
  const restore = quiet(); let n = 0;
  const r = await withRetry({ start: () => (n++, fail(1, overloaded("busy"))), op: "op", timeoutMs: 100 });
  restore();
  assert.equal(n, 1); assert.equal(r.ok, false); assert.equal((r as any).reason, "error"); assert.equal((r as any).error.message, "busy");
});
test("withRetry: does not retry on timeout by default", async () => {
  const restore = quiet(); let n = 0;
  const r = await withRetry({ start: () => (n++, sleep(500, 1)), op: "op", timeoutMs: 20 });
  restore();
  assert.equal(n, 1); assert.deepEqual((r as any).reason, "timeout");
});
test("withRetry: retryOnTimeout runs every attempt", async () => {
  const restore = quiet(); let n = 0;
  const r = await withRetry({ start: () => (n++, sleep(500, 1)), op: "op", timeoutMs: 20, maxAttempts: 3, baseBackoffMs: 1, budgetMs: 1000, retryOnTimeout: true });
  restore();
  assert.equal(n, 3); assert.equal((r as any).reason, "timeout");
});
test("withRetry: backoff is within [0, min(cap, base*2^(n-1))] and uses random()", async () => {
  const restore = quiet();
  const r = await withRetry({ start: () => fail(1, retryable("x")), op: "op", timeoutMs: 100, maxAttempts: 4, baseBackoffMs: 100, maxBackoffMs: 150, budgetMs: 10_000, random: () => 1 });
  restore();
  assert.deepEqual(r.attempts.map((a) => a.backoffMs), [0, 100, 150, 150]);
});
test("withRetry: stops with 'budget' when the next backoff+attempt won't fit", async () => {
  const restore = quiet(); let n = 0;
  const t0 = Date.now();
  const r = await withRetry({ start: () => (n++, fail(1, retryable("x"))), op: "op", timeoutMs: 100, maxAttempts: 10, baseBackoffMs: 200, budgetMs: 300, random: () => 1 });
  restore();
  assert.equal((r as any).reason, "budget"); assert.ok(n >= 1 && n <= 2); assert.ok(Date.now() - t0 <= 400);
});
test("withRetry: per-attempt timeout is clipped to the remaining budget", async () => {
  const restore = quiet();
  const t0 = Date.now();
  const r = await withRetry({ start: () => sleep(5000, 1), op: "op", timeoutMs: 5000, budgetMs: 100 });
  restore();
  assert.equal((r as any).reason, "timeout"); assert.ok(Date.now() - t0 < 300);
});

test("withTimeout: clears its timer when the call wins", async () => {
  const restore = quiet();
  const live = new Set<unknown>();
  const st = globalThis.setTimeout, ct = globalThis.clearTimeout;
  globalThis.setTimeout = ((fn: any, ms: any) => { const id = st(() => { live.delete(id); fn(); }, ms); live.add(id); return id; }) as any;
  globalThis.clearTimeout = ((id: any) => { live.delete(id); ct(id); }) as any;
  try {
    await withTimeout({ promise: Promise.resolve(1), timeoutMs: 10_000, op: "t" });
    assert.equal(live.size, 0, "timeout timer still pending after the call won");
  } finally { globalThis.setTimeout = st; globalThis.clearTimeout = ct; restore(); }
});

test("withTimeout: a rejection after the timeout is not an unhandled rejection", async () => {
  const restore = quiet();
  const unhandled: unknown[] = [];
  const h = (e: unknown) => unhandled.push(e);
  process.on("unhandledRejection", h);
  try {
    await withTimeout({ promise: fail(50, new Error("late")), timeoutMs: 10, op: "t" });
    await sleep(120);
    assert.deepEqual(unhandled, []);
  } finally { process.off("unhandledRejection", h); restore(); }
});

test("withRetry: summary line reports the failure reason", async () => {
  const lines: string[] = []; const o = console.log; console.log = (s: string) => lines.push(s);
  await withRetry({ start: () => fail(1, overloaded("busy")), op: "op", timeoutMs: 100 });
  console.log = o;
  const summary = lines.map((l) => JSON.parse(l)).find((j) => j.ev === "rpc.retry");
  assert.equal(summary.outcome, "error");
  assert.equal(summary.attempts, 1);
});
