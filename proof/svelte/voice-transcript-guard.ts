// Fail-closed guard: assistant audio must never become user input (#5).
//
// The half-duplex gate (voice-half-duplex.ts) suppresses the mic while the
// agent produces audio, but it cannot retroactively reject a transcript the
// STT finalized from audio captured just before the mute took effect, or in
// the brief tail after the mic re-arms (loudspeaker decay + room reverb). This
// pure guard is the backstop: it decides whether a transcript may be accepted
// as a user turn given the gate state and timing.
//
// Pure/deterministic — the caller supplies `now` (ms). No I/O, no timers.

/** Window after the mic re-arms during which transcripts are still treated as
 *  probable self-echo and rejected. Kept just under the 400ms re-arm debounce
 *  so a genuine user reply right after the "your turn" cue still lands, while
 *  the loudspeaker tail does not. */
export const TRANSCRIPT_GUARD_MS = 350;

export type TranscriptGuardState = {
  /** True while the agent is producing audio (mic suppressed). */
  suppressed: boolean;
  /** Timestamp of the most recent re-arm, or -Infinity if never. */
  lastReArmAt: number;
};

export function initialTranscriptGuard(): TranscriptGuardState {
  return { suppressed: false, lastReArmAt: -Infinity };
}

/** Agent started producing audio: suppress. */
export function onSuppress(state: TranscriptGuardState): TranscriptGuardState {
  return { suppressed: true, lastReArmAt: state.lastReArmAt };
}

/** Mic re-armed at `now`: clear suppression and start the guard window. */
export function onReArm(state: TranscriptGuardState, now: number): TranscriptGuardState {
  return { suppressed: false, lastReArmAt: now };
}

export type TranscriptDecision = { accept: boolean; reason: "ok" | "suppressed" | "guard-window" };

/**
 * Decide whether a (final) transcript observed at `now` may be accepted as a
 * user turn. Fail closed: reject while suppressed, and within
 * `guardMs` of the last re-arm.
 */
export function acceptTranscript(
  state: TranscriptGuardState,
  now: number,
  guardMs: number = TRANSCRIPT_GUARD_MS,
): TranscriptDecision {
  if (state.suppressed) return { accept: false, reason: "suppressed" };
  if (now - state.lastReArmAt < guardMs) return { accept: false, reason: "guard-window" };
  return { accept: true, reason: "ok" };
}
