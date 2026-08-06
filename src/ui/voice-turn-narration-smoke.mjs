#!/usr/bin/env node
// Locks the #1 C3b/C4 server voice-turn contract: onTurn streams (async
// generator) and emits a bounded up-front ack + "still working" check-ins on
// slow turns while staying terse on fast ones. Pure narration/check-in policy
// is unit-tested in src/voice-narration.test.ts; this guards the wiring.
import { readFileSync } from "node:fs";

const agent = readFileSync(new URL("../../src/voice-think-agent.ts", import.meta.url), "utf8");
const chat = readFileSync(new URL("../../src/ui/Chat.svelte", import.meta.url), "utf8");

function has(needle, label) {
  if (!agent.includes(needle)) throw new Error(`${label}: missing ${JSON.stringify(needle)}`);
}

function hasChat(needle, label) {
  if (!chat.includes(needle)) throw new Error(`${label}: missing ${JSON.stringify(needle)}`);
}

has("import { StillWorkingTimer, WORK_ACK } from \"./voice-narration\"", "voice turn imports the check-in policy");
has("Promise<AsyncGenerator<string>>", "onTurn returns a streaming AsyncGenerator (multi-utterance TTS)");
has("VOICE_ACK_THRESHOLD_MS", "fast turns stay terse; ack only past a threshold");
has("yield WORK_ACK;", "slow turns speak an up-front acknowledgement");
has("new StillWorkingTimer(", "slow turns emit bounded 'still working' check-ins");
has("checkins.tick(", "check-ins are driven by the bounded idle timer");
has("await facet.runVoiceTurnStream(transcript)", "the streamed reply still comes from the canonical facet turn");
// Feedback safety note is documented; the generator only yields agent audio
// (spoken while the client half-duplex gate has the mic suppressed).
has("cannot feed back", "documents that yielded audio is feedback-safe");
hasChat("let voicePreparing = $state(false)", "voice preparation is separate from activation");
hasChat("let voicePreparationReady = $state(false)", "prepared ready state is separate from activation");
hasChat("if (voiceEnabled || voiceStarting || voicePreparing)", "a preparing voice session can be stopped");
hasChat("voicePreparing = false;\n        voicePreparationReady = true", "a ready prepared session releases the second tap");
hasChat("voicePreparationReady = false;\n    voiceStarting = true", "only an actual call start enters the starting state");
hasChat(">Stop speaking</button>", "the voice stop control has truthful text");
hasChat("Spoken barge-in is unavailable. Use Stop speaking to stop audio and listening on this device; the chat response may still finish.", "the stop control discloses the unavailable barge-in path without claiming canonical turn cancellation");

console.log("✓ voice turn narration smoke: streaming narration and truthful local stop wiring are present");
