import assert from "node:assert/strict";
import { test } from "node:test";
import { PiTranscript } from "./pi-transcript";

test("snapshot plus streamed deltas produce one growing assistant message", () => {
  const t = new PiTranscript();
  t.applySnapshot({ busy: false, model: "claude-opus-5-5", entries: [{ id: 1, kind: "pi.user", model: [{ role: "user", content: "hi" }] }], partial: null, tools: [], queued: 0 });
  t.applyEvents([{ type: "run_start" }, { type: "message_start", message: { role: "assistant", content: [] } }, { type: "message_update", changes: [{ type: "text_start", contentIndex: 0, block: { type: "text", text: "" } }, { type: "text_delta", contentIndex: 0, delta: "Hel" }] }]);
  t.applyEvents([{ type: "message_update", changes: [{ type: "text_delta", contentIndex: 0, delta: "lo" }] }]);
  const messages = t.messages();
  assert.equal(messages.length, 2);
  assert.equal(messages[1].streaming, true);
  assert.deepEqual(messages[1].parts, [{ kind: "text", text: "Hello" }]);
  assert.equal(t.busy, true);
});

test("tool calls resolve with their results and consecutive assistant entries merge", () => {
  const t = new PiTranscript();
  t.applySnapshot({ busy: false, model: "", entries: [
    { id: 1, kind: "pi.user", model: [{ role: "user", content: "ls" }] },
    { id: 2, kind: "pi.assistant", model: [{ role: "assistant", content: [{ type: "toolCall", id: "c1", name: "exec", arguments: { command: "ls" } }], stopReason: "toolUse" }] },
    { id: 3, kind: "pi.tool-result", model: [{ role: "toolResult", toolCallId: "c1", content: [{ type: "text", text: "a.txt" }], isError: false }] },
    { id: 4, kind: "pi.assistant", model: [{ role: "assistant", content: [{ type: "text", text: "one file" }], stopReason: "stop" }] },
  ], partial: null, tools: [], queued: 0 });
  const messages = t.messages();
  assert.equal(messages.length, 2);
  const [tool, text] = messages[1].parts;
  assert.equal(tool.kind === "tool" && tool.tool.state, "done");
  assert.equal(tool.kind === "tool" && tool.tool.result, "a.txt");
  assert.deepEqual(text, { kind: "text", text: "one file" });
});

test("run_end clears busy and the partial", () => {
  const t = new PiTranscript();
  t.applyEvents([{ type: "run_start" }, { type: "message_start", message: { role: "assistant", content: [{ type: "text", text: "x" }] } }, { type: "run_end" }]);
  assert.equal(t.busy, false);
  assert.equal(t.messages().length, 0);
});

test("the user's own message_end does not wipe the assistant reply in progress", () => {
  const t = new PiTranscript();
  t.applyEvents([
    { type: "message_start", message: { role: "user", content: "q" } },
    { type: "message_end", entry: { id: 5, kind: "pi.user", model: [{ role: "user", content: "q" }] } },
    { type: "run_start" },
    { type: "message_start", message: { role: "assistant", content: [] } },
    { type: "message_update", changes: [{ type: "text_start", contentIndex: 0, block: { type: "text", text: "A" } }] },
  ]);
  const messages = t.messages();
  assert.equal(messages.length, 2);
  assert.equal(messages[1].streaming, true);
  assert.equal(t.busy, true);
});

test("a turn's end uses the time each entry was written, not the step start", () => {
  const transcript = new PiTranscript();
  transcript.applySnapshot({
    busy: false,
    model: "m",
    queued: 0,
    tools: [],
    partial: null,
    entryTimes: { "1": 1_000, "2": 61_000 },
    entries: [
      { id: 1, kind: "pi.user", model: [{ role: "user", content: "hi", timestamp: 1_000 }] },
      { id: 2, kind: "pi.assistant", model: [{ role: "assistant", content: [{ type: "text", text: "done" }], timestamp: 1_000 }] },
    ],
  } as never);
  const [, agent] = transcript.messages();
  assert.equal(agent!.endedAt, 61_000);
});
