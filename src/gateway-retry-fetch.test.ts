import assert from "node:assert/strict";
import test from "node:test";
import { createRetryFetch, parseRetryAfterMs, nextBackoffMs } from "./gateway-retry-fetch";

function res(status: number, statusText = "", headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : "body", { status, statusText, headers });
}

test("parseRetryAfterMs handles delta-seconds, HTTP-date, absent, and clamps", () => {
  const now = 1_000_000;
  assert.equal(parseRetryAfterMs("2", now, 8000), 2000);
  assert.equal(parseRetryAfterMs("999", now, 8000), 8000, "clamped to cap");
  assert.equal(parseRetryAfterMs(null, now, 8000), null);
  assert.equal(parseRetryAfterMs("garbage", now, 8000), null);
  const dateMs = parseRetryAfterMs(new Date(now + 1500).toUTCString(), now, 8000);
  assert.ok(dateMs !== null && Math.abs(dateMs - 1500) < 1000, "HTTP-date -> ~delta ms");
});

test("nextBackoffMs grows exponentially and is capped", () => {
  const r = () => 0.5; // mid jitter
  const a0 = nextBackoffMs(0, 500, 8000, r);
  const a1 = nextBackoffMs(1, 500, 8000, r);
  const a2 = nextBackoffMs(2, 500, 8000, r);
  assert.ok(a1 > a0 && a2 > a1, "monotonic growth");
  assert.ok(nextBackoffMs(10, 500, 8000, r) === 8000, "capped");
});

test("retries a 429 then returns the eventual success", async () => {
  let calls = 0;
  const slept: number[] = [];
  const fetchImpl = (async () => { calls++; return calls < 3 ? res(429) : res(200); }) as typeof fetch;
  const rf = createRetryFetch({ fetch: fetchImpl, maxAttempts: 3, sleep: async (ms) => { slept.push(ms); }, now: () => 0, random: () => 0.5 });
  const out = await rf("https://gw/x", { method: "POST" });
  assert.equal(out.status, 200);
  assert.equal(calls, 3, "first + two retries");
  assert.equal(slept.length, 2, "slept between the three attempts");
});

test("honors Retry-After over computed backoff", async () => {
  const slept: number[] = [];
  let calls = 0;
  const fetchImpl = (async () => { calls++; return calls < 2 ? res(429, "", { "retry-after": "3" }) : res(200); }) as typeof fetch;
  const rf = createRetryFetch({ fetch: fetchImpl, maxAttempts: 3, sleep: async (ms) => { slept.push(ms); }, now: () => 0, random: () => 0.5 });
  await rf("https://gw/x");
  assert.deepEqual(slept, [3000], "waited exactly the Retry-After");
});

test("returns the last 429 after exhausting attempts (turn fails through)", async () => {
  let calls = 0;
  const fetchImpl = (async () => { calls++; return res(429); }) as typeof fetch;
  const rf = createRetryFetch({ fetch: fetchImpl, maxAttempts: 3, sleep: async () => {}, now: () => 0, random: () => 0.5 });
  const out = await rf("https://gw/x");
  assert.equal(out.status, 429);
  assert.equal(calls, 3, "tried maxAttempts times");
});

test("non-rate-limit responses pass through with no retry", async () => {
  let calls = 0;
  const fetchImpl = (async () => { calls++; return res(200); }) as typeof fetch;
  const rf = createRetryFetch({ fetch: fetchImpl, sleep: async () => {} });
  const out = await rf("https://gw/x");
  assert.equal(out.status, 200);
  assert.equal(calls, 1, "no retry for success");

  let ecalls = 0;
  const errFetch = (async () => { ecalls++; return res(500); }) as typeof fetch;
  const rf2 = createRetryFetch({ fetch: errFetch, sleep: async () => {} });
  assert.equal((await rf2("https://gw/x")).status, 500);
  assert.equal(ecalls, 1, "a 500 is not a rate limit; no retry");
});

test("respects the total wait budget", async () => {
  let calls = 0;
  const slept: number[] = [];
  const fetchImpl = (async () => { calls++; return res(429, "", { "retry-after": "8" }); }) as typeof fetch;
  const rf = createRetryFetch({ fetch: fetchImpl, maxAttempts: 5, capMs: 8000, totalCapMs: 10000, sleep: async (ms) => { slept.push(ms); }, now: () => 0, random: () => 0.5 });
  await rf("https://gw/x");
  // First wait 8s; a second 8s would exceed the 10s total budget, so we stop.
  assert.deepEqual(slept, [8000]);
  assert.equal(calls, 2, "stopped once the wait budget would be exceeded");
});
