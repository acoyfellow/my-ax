import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./Chat.svelte", import.meta.url), "utf8");

test("voice mode is enabled before the first call completion settles", () => {
  const activation = source.indexOf("const attempt = voiceActivation.activate");
  const enabled = source.indexOf("voiceEnabled = true;", activation);
  const completion = source.indexOf("void attempt.completion.then", activation);

  assert.notEqual(activation, -1);
  assert.notEqual(enabled, -1);
  assert.notEqual(completion, -1);
  assert.ok(enabled < completion);
});

test("idle status can resume an active connected voice call", async () => {
  const { shouldResumeVoiceCall } = await import("./voice-continue");
  assert.equal(shouldResumeVoiceCall({ enabled: true, status: "idle", connected: true }), true);
});
