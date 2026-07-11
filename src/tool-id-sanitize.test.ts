import assert from "node:assert/strict";
import test from "node:test";
import type { ModelMessage } from "ai";
import { isValidToolCallId, sanitizeToolCallId, sanitizeToolCallIds } from "./tool-id-sanitize";

test("leaves a conforming id unchanged", () => {
  assert.equal(sanitizeToolCallId("toolu_01ABC-xyz_123"), "toolu_01ABC-xyz_123");
  assert.ok(isValidToolCallId("toolu_01ABC-xyz_123"));
});

test("rewrites ids with illegal characters into the allowed grammar", () => {
  for (const bad of ["job:123:456", "server.tool", "a/b c", "call#1"]) {
    const out = sanitizeToolCallId(bad);
    assert.match(out, /^[a-zA-Z0-9_-]+$/, `${bad} -> ${out}`);
    assert.ok(!isValidToolCallId(bad));
  }
});

test("is deterministic and collision-resistant for distinct ids", () => {
  assert.equal(sanitizeToolCallId("a.b"), sanitizeToolCallId("a.b"));
  assert.notEqual(sanitizeToolCallId("a.b"), sanitizeToolCallId("a:b"));
});

test("falls back to a fixed token for empty/non-string ids", () => {
  assert.equal(sanitizeToolCallId(""), "toolcall_unknown");
  assert.equal(sanitizeToolCallId(undefined), "toolcall_unknown");
  assert.match(sanitizeToolCallId(""), /^[a-zA-Z0-9_-]+$/);
});

test("bounds otherwise-valid ids to the strict provider max length", () => {
  const long = `call_${"a".repeat(70)}`;
  const out = sanitizeToolCallId(long);
  assert.equal(out.length, 64);
  assert.match(out, /^[a-zA-Z0-9_-]+$/);
  assert.ok(!isValidToolCallId(long));
  assert.ok(isValidToolCallId(out));
  assert.equal(sanitizeToolCallId(long), out);
  assert.notEqual(sanitizeToolCallId(`${long}b`), out);
});

test("rewrites a tool-call and its tool-result to the SAME id so the pair stays linked", () => {
  const messages: ModelMessage[] = [
    { role: "assistant", content: [
      { type: "text", text: "calling" },
      { type: "tool-call", toolCallId: "job:9:1", toolName: "work_code", input: {} },
    ] },
    { role: "tool", content: [
      { type: "tool-result", toolCallId: "job:9:1", toolName: "work_code", output: { type: "text", value: "ok" } },
    ] },
  ] as unknown as ModelMessage[];

  const changes: Array<[string, string]> = [];
  const out = sanitizeToolCallIds(messages, (b, a) => changes.push([b, a]));

  const callId = (out[0].content as any[])[1].toolCallId;
  const resultId = (out[1].content as any[])[0].toolCallId;
  assert.equal(callId, resultId);
  assert.match(callId, /^[a-zA-Z0-9_-]+$/);
  assert.equal(changes.length, 2);
});

test("returns the original array reference when nothing needs rewriting", () => {
  const messages: ModelMessage[] = [
    { role: "user", content: "hello" },
    { role: "assistant", content: [
      { type: "tool-call", toolCallId: "toolu_ok", toolName: "x", input: {} },
    ] },
  ] as unknown as ModelMessage[];
  assert.equal(sanitizeToolCallIds(messages), messages);
});

test("does not mutate the input messages", () => {
  const messages: ModelMessage[] = [
    { role: "assistant", content: [
      { type: "tool-call", toolCallId: "bad.id", toolName: "x", input: {} },
    ] },
  ] as unknown as ModelMessage[];
  sanitizeToolCallIds(messages);
  assert.equal((messages[0].content as any[])[0].toolCallId, "bad.id");
});

test("normalizes a non-string tool-call id (number) instead of skipping it", () => {
  const messages = [
    { role: "assistant", content: [
      { type: "tool-call", toolCallId: 17, toolName: "x", input: {} },
    ] },
  ] as unknown as ModelMessage[];
  const out = sanitizeToolCallIds(messages);
  assert.equal((out[0].content as any[])[0].toolCallId, "toolcall_unknown");
});

test("normalizes a null tool-result id independently", () => {
  const messages = [
    { role: "tool", content: [
      { type: "tool-result", toolCallId: null, toolName: "x", output: { type: "text", value: "ok" } },
    ] },
  ] as unknown as ModelMessage[];
  const changes: Array<[string, string]> = [];
  const out = sanitizeToolCallIds(messages, (b, a) => changes.push([b, a]));
  assert.equal((out[0].content as any[])[0].toolCallId, "toolcall_unknown");
  assert.deepEqual(changes, [["null", "toolcall_unknown"]]);
});
