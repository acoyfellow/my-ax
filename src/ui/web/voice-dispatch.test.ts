import assert from "node:assert/strict";
import test from "node:test";
import { CONFIRM_WINDOW_MS, confirmStillValid, voiceEffect, voiceSummary } from "./voice-dispatch";

test("open and stop reuse the app's existing window events", () => {
  assert.deepEqual(voiceEffect({ kind: "open", target: "desk" }), { type: "event", name: "my-ax:desk-open" });
  assert.deepEqual(voiceEffect({ kind: "open", target: "root" }), { type: "event", name: "my-ax:root-open" });
  assert.deepEqual(voiceEffect({ kind: "stop" }), { type: "event", name: "my-ax:voice-stop" });
});

test("ask sends the text through the page input; desk actions go to the server", () => {
  assert.deepEqual(voiceEffect({ kind: "ask", text: "what broke?" }), { type: "event", name: "my-ax:voice-ask", detail: { text: "what broke?" } });
  assert.deepEqual(voiceEffect({ kind: "approve", card: 2 }), { type: "desk", kind: "approve", card: 2 });
});

test("summaries say what will happen in plain words", () => {
  assert.equal(voiceSummary({ kind: "dismiss", card: 4 }), "Dismiss desk card 4");
  assert.equal(voiceSummary({ kind: "open", target: "settings" }), "Open settings");
});

test("a confirm only counts inside its window", () => {
  const pending = { command: { kind: "approve" as const, card: 1 }, heard: "ax approve card 1", expiresAt: 1000 + CONFIRM_WINDOW_MS };
  assert.equal(confirmStillValid(pending, 1000), true);
  assert.equal(confirmStillValid(pending, 1000 + CONFIRM_WINDOW_MS + 1), false);
  assert.equal(confirmStillValid(null, 0), false);
});
