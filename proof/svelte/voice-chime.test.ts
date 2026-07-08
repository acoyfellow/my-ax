import assert from "node:assert/strict";
import test from "node:test";
import { chimeForTransition, chimeTones } from "./voice-chime";

test("turn-start chime fires when the agent's turn begins (stop talking)", () => {
  assert.equal(chimeForTransition("listening", "thinking"), "turn-start");
  assert.equal(chimeForTransition("listening", "speaking"), "turn-start");
  assert.equal(chimeForTransition("idle", "thinking"), "turn-start");
});

test("your-turn cue fires when the mic returns to the owner", () => {
  assert.equal(chimeForTransition("speaking", "listening"), "your-turn");
  assert.equal(chimeForTransition("thinking", "listening"), "your-turn");
});

test("no chime on non-boundary or repeated frames", () => {
  assert.equal(chimeForTransition("speaking", "speaking"), null, "same status never re-chimes");
  assert.equal(chimeForTransition("thinking", "speaking"), null, "staying within the agent turn does not re-chime");
  assert.equal(chimeForTransition("listening", "listening"), null);
  assert.equal(chimeForTransition("idle", "listening"), null, "call start is not a turn boundary");
  assert.equal(chimeForTransition("speaking", "idle"), null, "call end is not a your-turn cue");
  assert.equal(chimeForTransition("listening", "idle"), null);
});

test("chime tones are bounded, audible, and short", () => {
  const start = chimeTones("turn-start");
  const your = chimeTones("your-turn");
  assert.ok(start.length >= 1 && your.length >= 1);
  for (const tones of [start, your]) {
    for (const t of tones) {
      assert.ok(t.freq >= 200 && t.freq <= 2000, `freq in audible band: ${t.freq}`);
      assert.ok(t.gain > 0 && t.gain <= 0.2, `gain soft and non-zero: ${t.gain}`);
      assert.ok(t.duration > 0 && t.duration <= 0.3, `duration short: ${t.duration}`);
      assert.ok(t.start >= 0, "start offset non-negative");
    }
  }
  // turn-start is a rising two-note motif; your-turn is a single softer note.
  assert.equal(start.length, 2);
  assert.ok(start[1].freq > start[0].freq, "turn-start rises");
  assert.equal(your.length, 1);
  assert.ok(your[0].gain <= start[0].gain, "your-turn is not louder than turn-start");
});
