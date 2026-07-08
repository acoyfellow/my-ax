import assert from "node:assert/strict";
import test from "node:test";
import {
  initialTranscriptGuard,
  onSuppress,
  onReArm,
  acceptTranscript,
  TRANSCRIPT_GUARD_MS,
} from "./voice-transcript-guard";

test("a normal user transcript well after re-arm is accepted", () => {
  let g = initialTranscriptGuard();
  g = onReArm(g, 1000);
  const d = acceptTranscript(g, 1000 + TRANSCRIPT_GUARD_MS + 50);
  assert.equal(d.accept, true);
  assert.equal(d.reason, "ok");
});

test("a transcript arriving WHILE suppressed is rejected (assistant audio)", () => {
  let g = initialTranscriptGuard();
  g = onSuppress(g);
  const d = acceptTranscript(g, 5000);
  assert.equal(d.accept, false);
  assert.equal(d.reason, "suppressed");
});

test("a transcript within the guard window after re-arm is rejected (self-echo tail)", () => {
  let g = initialTranscriptGuard();
  g = onSuppress(g);
  g = onReArm(g, 2000);
  const d = acceptTranscript(g, 2000 + TRANSCRIPT_GUARD_MS - 1);
  assert.equal(d.accept, false);
  assert.equal(d.reason, "guard-window");
});

test("a transcript exactly at the guard boundary is accepted", () => {
  let g = initialTranscriptGuard();
  g = onReArm(g, 2000);
  const d = acceptTranscript(g, 2000 + TRANSCRIPT_GUARD_MS);
  assert.equal(d.accept, true);
});

test("suppress -> rearm -> suppress again re-closes acceptance", () => {
  let g = initialTranscriptGuard();
  g = onSuppress(g);
  g = onReArm(g, 1000);
  assert.equal(acceptTranscript(g, 1000 + TRANSCRIPT_GUARD_MS + 10).accept, true, "open after guard");
  g = onSuppress(g); // agent speaks again
  assert.equal(acceptTranscript(g, 9999).accept, false, "closed again while speaking");
});

test("initial state (never spoke) accepts a first user transcript", () => {
  const g = initialTranscriptGuard();
  // lastReArmAt = -Infinity so now - (-Infinity) >= guard is always true.
  assert.equal(acceptTranscript(g, 0).accept, true);
});

test("guard window is under the 400ms re-arm debounce (so real replies land)", () => {
  assert.ok(TRANSCRIPT_GUARD_MS < 400 && TRANSCRIPT_GUARD_MS >= 250);
});
