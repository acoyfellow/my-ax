import assert from "node:assert/strict";
import { test } from "node:test";
import { PiTranscript } from "./pi-transcript";

test("a turn that fails with no content still shows its error", () => {
  const t = new PiTranscript();
  t.applySnapshot({ busy: false, model: "", entries: [
    { id: 1, kind: "pi.user", model: [{ role: "user", content: "hey" }] },
    { id: 2, kind: "pi.assistant", model: [{ role: "assistant", content: [], stopReason: "error", errorMessage: "This model requires gateway authentication." }] },
  ], partial: null, tools: [], queued: 0 });
  const errors = t.messages().filter((message) => message.role === "error");
  assert.equal(errors.length, 1);
  assert.equal(errors[0].content, "This model requires gateway authentication.");
});

test("a turn that fails with no error text still says it failed", () => {
  const t = new PiTranscript();
  t.applySnapshot({ busy: false, model: "", entries: [
    { id: 1, kind: "pi.user", model: [{ role: "user", content: "hey" }] },
    { id: 2, kind: "pi.assistant", model: [{ role: "assistant", content: [], stopReason: "error" }] },
  ], partial: null, tools: [], queued: 0 });
  const errors = t.messages().filter((message) => message.role === "error");
  assert.equal(errors.length, 1);
  assert.match(errors[0].content, /failed/i);
});

test("a run that ends with an error event shows the error after a reload-free stream", () => {
  const t = new PiTranscript();
  t.applySnapshot({ busy: false, model: "", entries: [{ id: 1, kind: "pi.user", model: [{ role: "user", content: "hey" }] }], partial: null, tools: [], queued: 0 });
  t.applyEvents([{ type: "run_start" }, { type: "message_start", message: { role: "assistant", content: [] } }]);
  t.applyEvents([{ type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "401 Unauthorized" } }, { type: "run_end" }]);
  const errors = t.messages().filter((message) => message.role === "error");
  assert.equal(errors.length, 1);
  assert.match(errors[0].content, /401/);
});
