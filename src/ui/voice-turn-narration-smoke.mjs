#!/usr/bin/env node
// Locks the #1 C3b/C4 server voice-turn contract: onTurn streams (async
// generator) and emits a bounded up-front ack + "still working" check-ins on
// slow turns while staying terse on fast ones. Pure narration/check-in policy
// is unit-tested in src/voice-narration.test.ts; this guards the wiring.
import { readFileSync } from "node:fs";

const agent = readFileSync(new URL("../../src/voice-think-agent.ts", import.meta.url), "utf8");

function has(needle, label) {
  if (!agent.includes(needle)) throw new Error(`${label}: missing ${JSON.stringify(needle)}`);
}

has("import { StillWorkingTimer } from \"./voice-narration\"", "voice turn imports the check-in policy");
has("import { CONVO_STYLE_SPECS, readConvoStyle } from \"./convo-style\"", "voice turn reads the conversation style");
has("Promise<AsyncGenerator<string>>", "onTurn returns a streaming AsyncGenerator (multi-utterance TTS)");
has("CONVO_STYLE_SPECS[await readConvoStyle(", "the conversation style picks the voice timings");
has("await settledWithin(runReply, voiceStyle.ackMs);", "fast turns stay terse; ack only past the style's threshold");
has("yield voiceStyle.ack;", "slow turns speak the style's up-front acknowledgement");
has("new StillWorkingTimer(voiceStyle.checkinMs, now)", "slow turns emit bounded 'still working' check-ins at the style's pace");
has("checkins.tick(", "check-ins are driven by the bounded idle timer");
has("const result = await chat.wait(receipt.operationId);", "the real reply comes from the pi chat turn");
// Feedback safety note is documented; the generator only yields agent audio
// (spoken while the client half-duplex gate has the mic suppressed).
has("cannot feed back", "documents that yielded audio is feedback-safe");

console.log("✓ voice turn narration smoke: onTurn streams, terse-fast/ack+checkins-slow, reply from facet");
