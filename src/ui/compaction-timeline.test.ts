import assert from "node:assert/strict";
import test from "node:test";
import { PiTranscript } from "./pi-transcript";

test("PiTranscript emits permanent timeline notes for pi.compaction and pi.reset", () => {
  const t = new PiTranscript();
  t.applySnapshot({
    busy: false,
    model: "m",
    entryTimes: { "2": 5_000, "4": 9_000 },
    entries: [
      { id: 1, kind: "pi.user", model: [{ role: "user", content: "start" }] },
      { id: 2, kind: "pi.compaction", model: [{ role: "user", content: [{ type: "text", text: "Header\n<summary>\nKept goal\n</summary>" }], timestamp: 4_000 }] },
      { id: 3, kind: "pi.user", model: [{ role: "user", content: "next" }] },
      { id: 4, kind: "pi.reset", model: [{ role: "user", content: "handoff note" }] },
    ],
    partial: null,
    tools: [],
    queued: 0,
  });
  const msgs = t.messages();
  assert.equal(msgs[1].role, "system");
  assert.equal(msgs[1].compaction?.kind, "compacted");
  assert.equal(msgs[1].compaction?.summaryText, "Kept goal");
  assert.equal(msgs[1].timestamp, 5_000);
  assert.equal(msgs[3].role, "system");
  assert.equal(msgs[3].compaction?.kind, "reset");
  assert.equal(msgs[3].compaction?.summaryText, "handoff note");
  assert.equal(msgs[3].timestamp, 9_000);
});
