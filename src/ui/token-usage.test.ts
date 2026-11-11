import assert from "node:assert/strict";
import test from "node:test";
import { countLabel, formatTokens, loadTokenUsage } from "./token-usage";

const summary = { windowDays: 7, todayTokens: 1200, weekTokens: 54321, cycles: 9, sessions: 3, models: [] };

test("token usage loads the owner summary from /api/cost-summary", async () => {
  const calls: string[] = [];
  const fetcher = (async (url: string) => { calls.push(url); return new Response(JSON.stringify({ ok: true, result: summary }), { status: 200 }); }) as typeof fetch;
  assert.deepEqual(await loadTokenUsage(fetcher), { kind: "ready", summary });
  assert.deepEqual(calls, ["/api/cost-summary"]);
});

test("a failed summary request becomes a short error state instead of throwing", async () => {
  const failing = (async () => new Response("nope", { status: 500 })) as typeof fetch;
  assert.deepEqual(await loadTokenUsage(failing), { kind: "error", message: "Token usage is not available (HTTP 500)." });
  const offline = (async () => { throw new TypeError("offline"); }) as typeof fetch;
  assert.deepEqual(await loadTokenUsage(offline), { kind: "error", message: "Token usage is not available (network error)." });
});

test("tokens are shown as grouped whole numbers with no currency", () => {
  assert.equal(formatTokens(1234567.4), "1,234,567");
  assert.equal(formatTokens(-5), "0");
});

test("counts use the singular for exactly one", () => {
  assert.equal(countLabel(1, "cycle", "cycles"), "1 cycle");
  assert.equal(countLabel(2234, "token", "tokens"), "2,234 tokens");
});
