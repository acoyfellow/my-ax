import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPiRows, composerAction, toolCallSummary } from "./pi-chat-view";

test("rows pair tool calls with their results and show the streaming partial", () => {
  const rows = buildPiRows({
    entries: [
      { id: 1, kind: "pi.user", model: [{ role: "user", content: "hi" }] },
      { id: 2, kind: "pi.assistant", model: [{ role: "assistant", content: [{ type: "toolCall", id: "c1", name: "exec", arguments: { command: "ls" } }] }] },
      { id: 3, kind: "pi.tool-result", model: [{ role: "toolResult", toolCallId: "c1", content: [{ type: "text", text: "a.txt" }], isError: false }] },
    ],
    partial: { role: "assistant", content: [{ type: "text", text: "Done" }] },
    tools: [],
  });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { kind: "user", key: "1:0", text: "hi" });
  const tool = rows[1].kind === "assistant" ? rows[1].tools[0] : null;
  assert.equal(tool?.output, "a.txt");
  assert.equal(tool?.done, true);
  assert.equal(rows[2].kind === "assistant" && rows[2].streaming, true);
});

test("a failed generation becomes a visible error row", () => {
  const rows = buildPiRows({ entries: [{ id: 4, kind: "pi.assistant", model: [{ role: "assistant", content: [], stopReason: "error", errorMessage: "gateway 502" }] }], partial: null, tools: [] });
  assert.deepEqual(rows, [{ kind: "error", key: "4:0:error", text: "gateway 502" }]);
});

test("busy chats queue instead of blocking the composer", () => {
  assert.equal(composerAction(true), "queue");
  assert.equal(composerAction(false), "send");
});

test("tool summaries prefer the command and stay short", () => {
  assert.equal(toolCallSummary({ command: "echo hi" }), "echo hi");
  assert.equal(toolCallSummary({ command: "x".repeat(200) }).length, 160);
});
