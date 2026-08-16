import assert from "node:assert/strict";
import test from "node:test";
import { isVoiceChannelPrompt, voiceChannelPrompt } from "./voice-channel";

test("voiceChannelPrompt marks the turn as audio so the model does not ask if it can hear", () => {
  const prompt = voiceChannelPrompt("Can you hear me?");
  assert.equal(isVoiceChannelPrompt(prompt), true);
  assert.match(prompt, /Can you hear me\?/);
  assert.match(prompt, /No markdown/);
});

test("plain chat is not a voice channel prompt", () => {
  assert.equal(isVoiceChannelPrompt("Can you hear me?"), false);
});
