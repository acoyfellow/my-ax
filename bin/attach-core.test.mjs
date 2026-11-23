import assert from "node:assert/strict";
import { test } from "node:test";
import { AttachView, inputFrame, pickChat, reconnectDelay, entryLines } from "./attach-core.mjs";

const user = (id, text) => ({ id, kind: "pi.user", model: [{ role: "user", content: text }] });
const assistant = (id, content, extra = {}) => ({ id, kind: "pi.assistant", model: [{ role: "assistant", content, ...extra }] });

function viewer() {
  let out = "";
  return { view: new AttachView((text) => { out += text; }), out: () => out };
}

test("a snapshot prints the conversation once, and a reconnect snapshot prints only what was missed", () => {
  const { view, out } = viewer();
  view.frame({ type: "pi_snapshot", view: { entries: [user(1, "hi"), assistant(2, [{ type: "text", text: "hello" }])] } });
  view.frame({ type: "pi_snapshot", view: { entries: [user(1, "hi"), assistant(2, [{ type: "text", text: "hello" }]), user(3, "from phone"), assistant(4, [{ type: "text", text: "seen" }])] } });
  assert.equal(out(), "> hi\nhello\n> from phone\nseen\n");
});

test("streamed text is not printed a second time when the final entry lands", () => {
  const { view, out } = viewer();
  view.frame({ type: "pi_events", events: [{ type: "message_update", changes: [{ type: "text_delta", delta: "four" }] }, { type: "message_update", changes: [{ type: "text_delta", delta: "teen" }] }] });
  view.frame({ type: "pi_events", events: [{ type: "entry_appended", entry: assistant(5, [{ type: "text", text: "fourteen" }]) }] });
  assert.equal(out(), "fourteen\n");
});

test("tool calls show as one line each, and failed tools and turns show the error", () => {
  assert.deepEqual(entryLines(assistant(1, [{ type: "toolCall", name: "tool_search" }, { type: "toolCall", name: "mcp__radar__top" }])), ["  · tool_search", "  · mcp__radar__top"]);
  assert.deepEqual(entryLines({ id: 2, kind: "pi.tool-result", model: [{ isError: true, toolName: "exec", content: [{ type: "text", text: "boom\nline 2" }] }] }), ["  ! exec: boom line 2"]);
  assert.deepEqual(entryLines({ id: 3, kind: "pi.tool-result", model: [{ isError: false, toolName: "exec", content: "ok" }] }), []);
  const { view, out } = viewer();
  view.frame({ type: "pi_events", events: [{ type: "message_end", message: { stopReason: "error", errorMessage: "rate limited" } }] });
  assert.equal(out(), "! rate limited\n");
});

test("input becomes a submit with an operation id, /abort aborts, and blank lines send nothing", () => {
  assert.deepEqual(inputFrame("  hello  ", "op1"), { type: "pi_submit", text: "hello", operationId: "op1" });
  assert.deepEqual(inputFrame("/abort", "op2"), { type: "pi_abort" });
  assert.equal(inputFrame("   ", "op3"), null);
});

test("chats are picked by exact id, unique prefix, or unique name, and only pi chats count", () => {
  const sessions = [
    { id: "aaaa1111", name: "Distill: student on Air", engine: "pi" },
    { id: "aaab2222", name: "Models", engine: "pi" },
    { id: "cccc3333", name: "Old think chat", engine: "think" },
  ];
  assert.equal(pickChat(sessions, "aaab2222").name, "Models");
  assert.equal(pickChat(sessions, "aaaa").name, "Distill: student on Air");
  assert.equal(pickChat(sessions, "distill").id, "aaaa1111");
  assert.equal(pickChat(sessions, "aaa"), null);
  assert.equal(pickChat(sessions, "old think"), null);
});

test("reconnect waits grow and stop at 15 seconds", () => {
  assert.deepEqual([1, 2, 3, 4, 10].map(reconnectDelay), [500, 1000, 2000, 4000, 15000]);
});
