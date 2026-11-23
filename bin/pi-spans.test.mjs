import assert from "node:assert/strict";
import { test } from "node:test";
import { sessionSpans } from "./pi-spans.mjs";

const lines = [
  { type: "session", id: "sess-1", timestamp: "2026-11-22T10:00:00.000Z" },
  { type: "message", id: "u1", parentId: null, timestamp: "2026-11-22T10:00:01.000Z", message: { role: "user", content: "SECRET PROMPT" } },
  { type: "message", id: "a1", parentId: "u1", message: { role: "assistant", content: [{ type: "text", text: "SECRET REPLY" }, { type: "toolCall", id: "call-1", name: "bash", arguments: { command: "SECRET ARG" } }], model: "claude-opus-5-5", usage: { input: 4, output: 202, cacheRead: 0, cacheWrite: 21612, cost: { total: 0.1121 } }, stopReason: "toolUse", timestamp: 1_795_000_003_858, durationMs: 3858 } },
  { type: "message", id: "t1", parentId: "a1", message: { role: "toolResult", toolCallId: "call-1", toolName: "bash", content: [{ type: "text", text: "exit 1\nSECRET OUTPUT" }], isError: true, durationMs: 162, timestamp: 1_795_000_004_020 } },
  { type: "custom", id: "c1" },
  "not json",
].map((line) => (typeof line === "string" ? line : JSON.stringify(line)));

test("a Pi session file becomes model and tool spans with tokens, cost, and timings", () => {
  const spans = sessionSpans(lines);
  assert.equal(spans.length, 2);
  const [model, tool] = spans;
  assert.equal(model.name, "pi.ai.request");
  assert.equal(model.model, "claude-opus-5-5");
  assert.equal(model.started_ms, 1_795_000_000_000);
  assert.equal(model.dur_ms, 3858);
  assert.equal(model.cache_write_tokens, 21612);
  assert.equal(model.cost_usd, 0.1121);
  assert.equal(tool.tool_name, "bash");
  assert.equal(tool.status, "error");
  assert.equal(tool.phase, "call");
  assert.equal(tool.task_name, "pi.tool");
  assert.match(model.span_id, /^[0-9a-f]{16}$/);
  assert.match(model.trace_id, /^[0-9a-f]{32}$/);
});

test("no prompt, reply, tool argument, or tool output leaves the machine", () => {
  const sent = JSON.stringify(sessionSpans(lines));
  assert.ok(!sent.includes("SECRET PROMPT"));
  assert.ok(!sent.includes("SECRET REPLY"));
  assert.ok(!sent.includes("SECRET ARG"));
  assert.ok(!sent.includes("SECRET OUTPUT"));
  assert.equal(sessionSpans(lines)[1].error, "tool error");
});

test("ids are stable across runs so a re-sync never duplicates, and old entries are skipped", () => {
  assert.deepEqual(sessionSpans(lines).map((span) => span.span_id), sessionSpans(lines).map((span) => span.span_id));
  assert.equal(sessionSpans(lines, 1_795_000_004_000).length, 1);
  assert.equal(sessionSpans(lines.slice(1)).length, 0);
});
