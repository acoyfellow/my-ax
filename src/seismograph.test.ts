import assert from "node:assert/strict";
import test from "node:test";
import { buildSeismographMap, classifySpanKind, normalizeSpanHeight } from "./seismograph";

test("classifySpanKind maps tool families, errors, and waits", () => {
  assert.equal(classifySpanKind({ tool_name: "cmux_pi_steer", status: "ok" }), "mac");
  assert.equal(classifySpanKind({ tool_name: "machinectl_call", status: "ok" }), "mac");
  assert.equal(classifySpanKind({ tool_name: "web_search", status: "ok" }), "web");
  assert.equal(classifySpanKind({ tool_name: "mcp__github__list_prs", status: "ok" }), "web");
  assert.equal(classifySpanKind({ tool_name: "exec", status: "ok" }), "box");
  assert.equal(classifySpanKind({ tool_name: "ask_user", status: "ok" }), "wait");
  assert.equal(classifySpanKind({ tool_name: null, status: "ok" }), "llm");
  assert.equal(classifySpanKind({ tool_name: "exec", status: "error", error: "boom" }), "err");
});

test("normalizeSpanHeight stays bounded in 12..100 and grows with work", () => {
  const tiny = normalizeSpanHeight({ dur_ms: 5, output_tokens: 0 });
  const medium = normalizeSpanHeight({ dur_ms: 1200, output_tokens: 200 });
  const huge = normalizeSpanHeight({ dur_ms: 90_000, output_tokens: 12_000 });
  assert.ok(tiny >= 12 && tiny <= 100);
  assert.ok(medium > tiny);
  assert.ok(huge >= medium && huge <= 100);
});

test("buildSeismographMap orders oldest-to-newest, caps bars, and flags blocked", () => {
  const rows = [
    { chat_id: "c1", tool_name: "ask_user", status: "ok", started_ms: 300, dur_ms: 40 },
    { chat_id: "c1", tool_name: "exec", status: "ok", started_ms: 100, dur_ms: 500 },
    { chat_id: "c1", tool_name: "cmux_pi_prompt", status: "ok", started_ms: 200, dur_ms: 800 },
    { chat_id: "c2", tool_name: null, status: "ok", started_ms: 150, dur_ms: 900, output_tokens: 450 },
  ];
  const map = buildSeismographMap(rows, 2);
  const p1 = map.get("c1");
  assert.ok(p1);
  assert.equal(p1.bars.length, 2);
  assert.deepEqual(
    p1.bars.map((b) => b.k),
    ["mac", "wait"],
  );
  assert.equal(p1.blocked, true);

  const p2 = map.get("c2");
  assert.ok(p2);
  assert.equal(p2.bars.length, 1);
  assert.equal(p2.bars[0].k, "llm");
  assert.equal(p2.blocked, false);
});
