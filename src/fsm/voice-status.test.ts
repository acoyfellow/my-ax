import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isAgentTurn, nextVoiceStatus, VOICE_STATUSES } from "./voice-status";

const chat = readFileSync(new URL("../ui/Chat.svelte", import.meta.url), "utf8");
const gate = readFileSync(new URL("../ui/voice-half-duplex.ts", import.meta.url), "utf8");
const chime = readFileSync(new URL("../ui/voice-chime.ts", import.meta.url), "utf8");

test("an unknown status from the voice server does not replace the current one", () => {
  assert.equal(nextVoiceStatus("listening", "reconnecting"), "listening");
  assert.equal(nextVoiceStatus("listening", "speaking"), "speaking");
});

test("the agent's turn is thinking or speaking, in one place", () => {
  assert.deepEqual(VOICE_STATUSES.filter(isAgentTurn), ["thinking", "speaking"]);
});

test("the chat, the mic gate and the chime share one voice status type", () => {
  for (const source of [chat, gate, chime]) assert.doesNotMatch(source, /=\s*"idle"\s*\|\s*"listening"\s*\|\s*"thinking"\s*\|\s*"speaking"/);
  assert.match(chat, /voiceStatus = nextVoiceStatus\(voiceStatus, status\);/);
});
