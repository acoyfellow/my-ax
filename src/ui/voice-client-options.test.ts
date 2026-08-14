import assert from "node:assert/strict";
import test from "node:test";
import { VOICE_CLIENT_OPTIONS } from "./voice-client-options";

test("voice client barge-in options match the tuned anti-false-interrupt values", () => {
  assert.deepEqual(VOICE_CLIENT_OPTIONS, {
    interruptThreshold: 0.09,
    interruptChunks: 2,
  });
  assert.ok(VOICE_CLIENT_OPTIONS.interruptThreshold >= 0.01);
  assert.ok(VOICE_CLIENT_OPTIONS.interruptThreshold <= 1);
  assert.ok(VOICE_CLIENT_OPTIONS.interruptChunks >= 1);
  assert.ok(VOICE_CLIENT_OPTIONS.interruptChunks <= 20);
});
