// Turn-boundary chime logic for hands-free voice mode.
//
// The owner's #1 trip-up: not knowing when to stop talking. A short chime when
// the agent's turn BEGINS (status enters "speaking", or "thinking" if it heads
// straight into work) is the "stop talking now" signal. A softer cue when the
// mic returns to the owner ("listening") signals "your turn". This module is a
// PURE decision function so it can be unit-tested without WebAudio; the Svelte
// layer owns the actual AudioContext + oscillator.
//
// Feedback-safety: the "turn-start" chime plays while the agent is (about to
// be) producing audio, i.e. while the half-duplex gate has the mic SUPPRESSED,
// so the chime cannot be transcribed. The "your-turn" cue plays as the mic
// re-arms; keep it short and low so its tail decays before capture resumes
// (the half-duplex re-arm debounce, ~400ms, covers this).

export type VoiceChimeStatus = "idle" | "listening" | "thinking" | "speaking";

/** Which chime to play, if any, on a status transition. */
export type ChimeCue = "turn-start" | "your-turn" | null;

/** Statuses where the agent is (or is about to be) producing audio — the
 *  owner should stop talking. Entering this set from a non-agent status is the
 *  "turn-start" boundary. */
function isAgentTurn(status: VoiceChimeStatus): boolean {
  return status === "thinking" || status === "speaking";
}

/**
 * Decide the chime for a status transition. Pure.
 *   prev !in agentTurn  -> next in agentTurn   => "turn-start" (stop talking)
 *   prev in agentTurn    -> next === listening  => "your-turn"  (your turn)
 *   otherwise                                    => null
 *
 * Only fires on the EDGE, so repeated "speaking"/"listening" frames don't
 * re-chime. `idle` never chimes (call start/stop is not a turn boundary).
 */
export function chimeForTransition(prev: VoiceChimeStatus, next: VoiceChimeStatus): ChimeCue {
  if (prev === next) return null;
  if (!isAgentTurn(prev) && isAgentTurn(next)) return "turn-start";
  if (isAgentTurn(prev) && next === "listening") return "your-turn";
  return null;
}

/** Oscillator recipe for each cue: a two-note motif for turn-start (attention),
 *  a single soft note for your-turn (gentle). Frequencies in Hz, times in s. */
export type ChimeTone = { freq: number; start: number; duration: number; gain: number };

export function chimeTones(cue: Exclude<ChimeCue, null>): ChimeTone[] {
  if (cue === "turn-start") {
    // Rising two-note "the agent is answering" cue — clear but brief (~0.3s).
    return [
      { freq: 660, start: 0, duration: 0.12, gain: 0.14 },
      { freq: 880, start: 0.12, duration: 0.16, gain: 0.14 },
    ];
  }
  // your-turn: a single soft low note (~0.18s).
  return [{ freq: 520, start: 0, duration: 0.18, gain: 0.09 }];
}
