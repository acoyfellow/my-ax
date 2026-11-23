import assert from "node:assert/strict";
import { test } from "node:test";
import { testDb } from "../domain/test-db";
import { askBrain, BRAIN_QUESTIONS } from "./brain-tools";
import { SpanBuffer, ingestSpans, pruneSpans, spanRow, SPAN_RETENTION_MS } from "./span-store";
import type { SpanRecord } from "./span-log";

const now = Date.UTC(2026, 10, 22, 12);
const owner = "owner@example.com";

function record(over: Partial<SpanRecord> & { attrs?: SpanRecord["attrs"] }): SpanRecord {
  return { ev: "pi.span", name: "pi.durable.phase", traceId: "t".repeat(32), spanId: crypto.randomUUID(), chat: "chat-a", startedMs: now - 60_000, durMs: 100, status: "ok", attrs: {}, ...over };
}

async function seeded() {
  const db = testDb();
  const flushes: Promise<void>[] = [];
  const buffer = new SpanBuffer(db as unknown as D1Database, () => owner, (flush) => flushes.push(flush));
  buffer.add(record({ attrs: { "task.name": "pi.tool", phase: "call", "tool.name": "machinectl_call" }, durMs: 58_000 }));
  buffer.add(record({ attrs: { "task.name": "pi.tool", phase: "call", "tool.name": "machinectl_call" }, durMs: 262, status: "error", error: "timed out" }));
  buffer.add(record({ attrs: { "task.name": "pi.tool", phase: "call", "tool.name": "mcp__radar__top" }, durMs: 756 }));
  buffer.add(record({ name: "pi.ai.request", chat: "chat-b", durMs: 5_187, attrs: { model: "claude-opus-5-5", "usage.input": 16, "usage.cache_read": 1_749_461, "usage.output": 3_612, "cost.total": 1.9024 } }));
  buffer.add(record({ attrs: { "task.name": "pi.generation", phase: "request", outcome: "done" }, durMs: 2_000 }));
  await Promise.all(flushes);
  const other = new SpanBuffer(db as unknown as D1Database, () => "someone@example.com", () => {});
  other.add(record({ attrs: { "task.name": "pi.tool", phase: "call", "tool.name": "secret_tool" } }));
  await other.flush();
  return db;
}

test("a finished turn flushes its spans to D1 in one batch, and brain_query answers every question", async () => {
  const db = await seeded();
  assert.equal(db.rows<{ n: number }>("SELECT COUNT(*) AS n FROM pi_spans WHERE owner_email = ?", owner)[0].n, 5);
  for (const question of BRAIN_QUESTIONS) {
    const answer = await askBrain(db as unknown as D1Database, owner, { question }, now);
    assert.ok(answer.rows.length > 0, question);
  }
  const tools = (await askBrain(db as unknown as D1Database, owner, { question: "tool_usage" }, now)).rows;
  assert.deepEqual(tools[0], { source: "my-ax", tool: "machinectl_call", calls: 2, failures: 1, avg_ms: 29_131, max_ms: 58_000, total_ms: 58_262 });
  const cost = (await askBrain(db as unknown as D1Database, owner, { question: "model_cost" }, now)).rows;
  assert.deepEqual(cost, [{ source: "my-ax", model: "claude-opus-5-5", chat: "chat-b", requests: 1, cost_usd: 1.9024, input_tokens: 16, cache_read_tokens: 1_749_461, output_tokens: 3_612, avg_ms: 5_187 }]);
  const errors = (await askBrain(db as unknown as D1Database, owner, { question: "errors" }, now)).rows;
  assert.equal(errors[0].error, "timed out");
});

test("brain_query only ever sees the asking owner's spans", async () => {
  const db = await seeded();
  for (const question of BRAIN_QUESTIONS) {
    const answer = await askBrain(db as unknown as D1Database, owner, { question, limit: 50 }, now);
    assert.ok(!JSON.stringify(answer).includes("secret_tool"), question);
  }
  const theirs = await askBrain(db as unknown as D1Database, "SOMEONE@example.com", { question: "tool_usage" }, now);
  assert.deepEqual(theirs.rows.map((row) => row.tool), ["secret_tool"]);
});

test("chat, tool and window scope the answer", async () => {
  const db = await seeded();
  const radar = await askBrain(db as unknown as D1Database, owner, { question: "tool_usage", tool: "mcp__radar__top" }, now);
  assert.deepEqual(radar.rows.map((row) => row.tool), ["mcp__radar__top"]);
  const chatB = await askBrain(db as unknown as D1Database, owner, { question: "chat_timeline", chat: "chat-b" }, now);
  assert.deepEqual(chatB.rows.map((row) => row.name), ["pi.ai.request"]);
  const later = await askBrain(db as unknown as D1Database, owner, { question: "chat_timeline", hours: 1 }, now + 2 * 3_600_000);
  assert.deepEqual(later.rows, []);
});

test("spans with no owner or chat are dropped, and a D1 failure never throws into the chat", async () => {
  const unowned = new SpanBuffer(testDb() as unknown as D1Database, () => undefined, () => {});
  unowned.add(record({}));
  assert.equal(unowned.pending(), 0);
  const failing = { prepare: () => ({ bind: () => ({}) }), batch: async () => { throw new Error("D1 down"); } } as unknown as D1Database;
  const buffer = new SpanBuffer(failing, () => owner, () => {});
  buffer.add(record({ chat: "unbound" }));
  assert.equal(buffer.pending(), 0);
  buffer.add(record({}));
  await buffer.flush();
  assert.equal(buffer.pending(), 0);
});

test("old spans are pruned after the retention window", async () => {
  const db = testDb();
  const buffer = new SpanBuffer(db as unknown as D1Database, () => owner, () => {});
  buffer.add(record({ startedMs: now - SPAN_RETENTION_MS - 1 }));
  buffer.add(record({ startedMs: now - 1_000 }));
  await buffer.flush();
  await pruneSpans(db as unknown as D1Database, now);
  assert.equal(db.rows<{ n: number }>("SELECT COUNT(*) AS n FROM pi_spans")[0].n, 1);
});

test("a span row keeps ids, timings, tokens and cost, and lowercases the owner", () => {
  const row = spanRow(record({ name: "pi.ai.request", attrs: { model: "m", "usage.input": 5, "cost.total": 0.5, prompt: "never stored" } }), "Owner@Example.com");
  assert.equal(row.owner_email, "owner@example.com");
  assert.equal(row.model, "m");
  assert.equal(row.input_tokens, 5);
  assert.equal(row.cost_usd, 0.5);
  assert.ok(!JSON.stringify(row).includes("never stored"));
});

const localSpan = (over: Record<string, unknown> = {}) => ({ span_id: "abcdef0123456789", trace_id: "0123456789abcdef0123456789abcdef", chat_id: "01a16406-55d1", name: "pi.ai.request", status: "ok", started_ms: now - 60_000, dur_ms: 3_858, model: "claude-opus-5-5", input_tokens: 4, output_tokens: 202, cache_write_tokens: 21_612, cost_usd: 0.1121, ...over });

test("local Pi spans are stored under the signed-in owner, namespaced by source, and bad rows are rejected", async () => {
  const db = testDb();
  const result = await ingestSpans(db as unknown as D1Database, "Owner@Example.com", "pi-local", [
    localSpan({ owner_email: "someone@example.com" }),
    localSpan({ span_id: "1111111111111111", name: "pi.durable.phase", phase: "call", task_name: "pi.tool", tool_name: "bash", model: undefined, cost_usd: undefined }),
    localSpan({ span_id: "not hex" }),
    localSpan({ span_id: "2222222222222222", name: "evil" }),
    localSpan({ span_id: "3333333333333333", chat_id: "../../x" }),
    localSpan({ span_id: "4444444444444444", dur_ms: -5 }),
    "nope",
  ]);
  assert.deepEqual(result, { stored: 2, rejected: 5 });
  const rows = db.rows<{ owner_email: string; span_id: string; chat_id: string; source: string }>("SELECT owner_email, span_id, chat_id, source FROM pi_spans ORDER BY span_id");
  assert.deepEqual(rows.map((row) => row.owner_email), ["owner@example.com", "owner@example.com"]);
  assert.ok(rows.every((row) => row.source === "pi-local" && row.span_id.startsWith("pi-local:") && row.chat_id === "pi-local:01a16406-55d1"));
  const again = await ingestSpans(db as unknown as D1Database, owner, "pi-local", [localSpan()]);
  assert.equal(again.stored, 1);
  assert.equal(db.rows<{ n: number }>("SELECT COUNT(*) AS n FROM pi_spans")[0].n, 2);
});

test("brain_query can split and filter my-ax and local Pi", async () => {
  const db = await seeded();
  await ingestSpans(db as unknown as D1Database, owner, "pi-local", [localSpan()]);
  const cost = (await askBrain(db as unknown as D1Database, owner, { question: "model_cost" }, now)).rows;
  assert.deepEqual(cost.map((row) => row.source).sort(), ["my-ax", "pi-local"]);
  const local = (await askBrain(db as unknown as D1Database, owner, { question: "chat_timeline", source: "pi-local" }, now)).rows;
  assert.deepEqual(local.map((row) => row.chat), ["pi-local:01a16406-55d1"]);
});
