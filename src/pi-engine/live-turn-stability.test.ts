import assert from "node:assert/strict";
import { test } from "node:test";
import { PiTranscript } from "../ui/pi-transcript";
import { viewEvents, type WatchedView } from "./view-events";

test("entry_appended for an assistant tool step clears the live partial so it is not duplicated while the tool runs", () => {
  const t = new PiTranscript();
  t.applyEvents([
    { type: "run_start" },
    { type: "message_update", changes: [{ type: "message", message: { role: "assistant", content: [{ type: "thinking", thinking: "checking" }, { type: "toolCall", id: "c1", name: "exec", arguments: { command: "ls" } }] } }] },
    { type: "entry_appended", entry: { id: 2, kind: "pi.assistant", model: [{ role: "assistant", content: [{ type: "thinking", thinking: "checking" }, { type: "toolCall", id: "c1", name: "exec", arguments: { command: "ls" } }], stopReason: "toolUse" }] } },
  ]);
  const [assistant] = t.messages();
  assert.equal(assistant!.parts.filter((part) => part.kind === "tool").length, 1);
  assert.equal(assistant!.parts.filter((part) => part.kind === "thinking").length, 1);
});

test("compaction events and snapshots track compacting state and clear on run_end", () => {
  const t = new PiTranscript();
  t.applySnapshot({ busy: true, compacting: true, model: "gemini-4-neon", entries: [], partial: null, tools: [], queued: 0 });
  assert.equal(t.compacting, true);
  t.applyEvents([{ type: "compaction_end" }]);
  assert.equal(t.compacting, false);
  t.applyEvents([{ type: "compaction_start" }]);
  assert.equal(t.compacting, true);
  t.applyEvents([{ type: "run_end" }]);
  assert.equal(t.compacting, false);
});

test("clearing partial without an appended assistant entry emits partial_cleared and clears the transcript partial", () => {
  const withPartial: WatchedView = { entries: [], docs: { "pi.live": { run: { taskId: 1 }, generation: { message: { role: "assistant", content: [{ type: "thinking", thinking: "hmm" }] } } } } };
  const withoutPartial: WatchedView = { entries: [], docs: { "pi.live": { run: { taskId: 1 } } } };
  const events = viewEvents(withPartial, withoutPartial);
  assert.deepEqual(events, [{ type: "partial_cleared" }]);
  const t = new PiTranscript();
  t.applyEvents([{ type: "message_update", changes: [{ type: "message", message: { role: "assistant", content: [{ type: "thinking", thinking: "hmm" }] } }] }]);
  assert.equal(t.messages().length, 1);
  t.applyEvents(events);
  assert.equal(t.messages().length, 0);
});
