import assert from "node:assert/strict";
import test from "node:test";
import { shouldResumeVoiceCall } from "./voice-continue";

test("after TTS the SDK idles the call; resume when voice is still enabled", () => {
  assert.equal(shouldResumeVoiceCall({ enabled: true, status: "idle", connected: true }), true);
});

test("do not resume while speaking, listening, or disconnected", () => {
  assert.equal(shouldResumeVoiceCall({ enabled: true, status: "speaking", connected: true }), false);
  assert.equal(shouldResumeVoiceCall({ enabled: true, status: "listening", connected: true }), false);
  assert.equal(shouldResumeVoiceCall({ enabled: true, status: "idle", connected: false }), false);
  assert.equal(shouldResumeVoiceCall({ enabled: false, status: "idle", connected: true }), false);
});
