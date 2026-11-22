import assert from "node:assert/strict";
import { test } from "node:test";
import { askBrain, brainQuery, brainRows, BRAIN_QUESTIONS } from "./brain-tools";

const now = Date.UTC(2026, 10, 22, 12);

test("every brain question reads only this service's pi.span lines, inside the asked window", () => {
  for (const question of BRAIN_QUESTIONS) {
    const query = brainQuery({ question, hours: 2 }, "my-ax", now) as { timeframe: { from: number; to: number }; parameters: { filters: Array<{ key: string; value: unknown }> } };
    assert.deepEqual(query.timeframe, { from: now - 2 * 3_600_000, to: now }, question);
    assert.ok(query.parameters.filters.some((filter) => filter.key === "$metadata.service" && filter.value === "my-ax"), question);
    assert.ok(query.parameters.filters.some((filter) => filter.key === "ev" && filter.value === "pi.span"), question);
  }
});

test("window and row limits are clamped, and chat and tool scope the query", () => {
  const query = brainQuery({ question: "tool_usage", hours: 10_000, limit: 9_999, chat: "c1", tool: "mcp__radar__top" }, "my-ax", now) as { timeframe: { from: number }; parameters: { limit: number; filters: Array<{ key: string; value: unknown }> } };
  assert.equal(query.timeframe.from, now - 7 * 24 * 3_600_000);
  assert.equal(query.parameters.limit, 50);
  const keys = query.parameters.filters.map((filter) => `${filter.key}=${filter.value}`);
  assert.ok(keys.includes("chat=c1"));
  assert.ok(keys.includes("attrs.tool.name=mcp__radar__top"));
  assert.ok(keys.includes("attrs.task.name=pi.tool"));
});

test("grouped results become one row per group with every calculation", () => {
  const rows = brainRows({ calculations: [
    { alias: "count", aggregates: [{ groups: [{ key: "attrs.tool.name", value: "exec" }, { key: "status", value: "ok" }], value: 12 }, { groups: [{ key: "attrs.tool.name", value: "tool_search" }, { key: "status", value: "ok" }], value: 3 }] },
    { alias: "median_ms", aggregates: [{ groups: [{ key: "attrs.tool.name", value: "exec" }, { key: "status", value: "ok" }], value: 801.6 }] },
    { alias: "cost_usd", aggregates: [{ groups: [{ key: "attrs.tool.name", value: "exec" }, { key: "status", value: "ok" }], value: 0.012345 }] },
  ] });
  assert.deepEqual(rows, [
    { "tool.name": "exec", status: "ok", count: 12, median_ms: 802, cost_usd: 0.0123 },
    { "tool.name": "tool_search", status: "ok", count: 3 },
  ]);
});

test("timeline results keep the step, timing and outcome without content", () => {
  const rows = brainRows({ events: { events: [{ timestamp: now, source: { name: "pi.durable.phase", durMs: 756, status: "ok", attrs: { phase: "call", "tool.name": "mcp__radar__top" } } }] } });
  assert.deepEqual(rows, [{ at: new Date(now).toISOString(), name: "pi.durable.phase", ms: 756, status: "ok", phase: "call", tool: "mcp__radar__top", model: undefined, cost: undefined, error: undefined }]);
});

test("askBrain posts to the account's Observability API with the token, and surfaces API errors", async () => {
  const seen: Array<{ url: string; auth: string | null }> = [];
  const ok = (async (url: string, init: RequestInit) => { seen.push({ url, auth: new Headers(init.headers).get("authorization") }); return Response.json({ success: true, result: { calculations: [] } }); }) as unknown as typeof fetch;
  const answer = await askBrain({ accountId: "acc", token: "tok", service: "my-ax", fetch: ok }, { question: "errors" }, now);
  assert.deepEqual(answer, { question: "errors", hours: 24, rows: [] });
  assert.deepEqual(seen, [{ url: "https://api.cloudflare.com/client/v4/accounts/acc/workers/observability/telemetry/query", auth: "Bearer tok" }]);
  const denied = (async () => Response.json({ success: false, errors: [{ message: "Forbidden" }] }, { status: 403 })) as unknown as typeof fetch;
  await assert.rejects(askBrain({ accountId: "acc", token: "bad", service: "my-ax", fetch: denied }, { question: "errors" }, now), /HTTP 403.*Forbidden/);
});

test("timeline reads nested attributes the way the Observability API returns them", () => {
  const rows = brainRows({ events: { events: [{ timestamp: now, source: { name: "pi.ai.request", durMs: 5187, status: "ok", attrs: { model: "claude-opus-5-5", cost: { total: 0.27 }, tool: { name: "exec" } } } }] } });
  assert.equal(rows[0].tool, "exec");
  assert.equal(rows[0].cost, 0.27);
  assert.equal(rows[0].model, "claude-opus-5-5");
});
