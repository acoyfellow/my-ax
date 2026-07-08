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

has("import { StillWorkingTimer, WORK_ACK } from \"./voice-narration\"", "voice turn imports the check-in policy");
has("Promise<AsyncGenerator<string>>", "onTurn returns a streaming AsyncGenerator (multi-utterance TTS)");
has("VOICE_ACK_THRESHOLD_MS", "fast turns stay terse; ack only past a threshold");
has("yield WORK_ACK;", "slow turns speak an up-front acknowledgement");
has("new StillWorkingTimer(", "slow turns emit bounded 'still working' check-ins");
has("checkins.tick(", "check-ins are driven by the bounded idle timer");
has("await facet.runVoiceTurn(transcript)", "the real reply still comes from the canonical facet turn");
// Feedback safety note is documented; the generator only yields agent audio
// (spoken while the client half-duplex gate has the mic suppressed).
has("cannot feed back", "documents that yielded audio is feedback-safe");

console.log("✓ voice turn narration smoke: onTurn streams, terse-fast/ack+checkins-slow, reply from facet");
