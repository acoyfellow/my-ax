import assert from "node:assert/strict";
import { test } from "node:test";
import { buildObservedTurns } from "./observe";

test("a turn lists its tool calls with durations and errors, and its model steps", () => {
  const turns = buildObservedTurns([
    { id: 1, ts: "2026-10-11T22:09:09Z", role: "user", tool: null, is_error: 0, content: "do it", meta_json: null },
    { id: 2, ts: "2026-10-11T22:09:12Z", role: "tool", tool: "work_code", is_error: 0, content: JSON.stringify({ ok: true, result: { exitCode: 0 } }), meta_json: JSON.stringify({ durationMs: 227 }) },
    { id: 3, ts: "2026-10-11T22:09:18Z", role: "tool", tool: "work_code", is_error: 0, content: JSON.stringify({ ok: true, result: { exitCode: -1, error: "SessionTerminatedError: shell exited (exit code: 124)" } }), meta_json: JSON.stringify({ durationMs: 5179 }) },
    { id: 4, ts: "2026-10-11T22:09:22Z", role: "assistant", tool: null, is_error: 0, content: "done", meta_json: JSON.stringify({ model: "gpt-5.6-terra", status: "completed" }) },
    { id: 5, ts: "2026-10-11T22:10:00Z", role: "user", tool: null, is_error: 0, content: "next", meta_json: null },
  ], [
    { ts: "2026-10-11T22:09:11Z", cycle_index: 0, model: "gpt-5.6-terra", finish_reason: "tool-calls", input_tokens: 10, output_tokens: 5 },
    { ts: "2026-10-11T22:10:05Z", cycle_index: 1, model: "gpt-5.6-terra", finish_reason: "stop", input_tokens: 12, output_tokens: 3 },
  ]);
  assert.equal(turns.length, 2);
  assert.deepEqual(turns[0].tools.map((tool) => [tool.durationMs, tool.ok]), [[227, true], [5179, false]]);
  assert.match(turns[0].tools[1].error ?? "", /exit code: 124/);
  assert.equal(turns[0].status, "completed");
  assert.deepEqual(turns[0].usage.map((step) => step.finishReason), ["tool-calls"]);
  assert.equal(turns[1].status, "running");
  assert.deepEqual(turns[1].usage.map((step) => step.finishReason), ["stop"]);
});
