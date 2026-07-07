// Half-duplex gate for voice chat.
//
// On a mobile PWA the phone loudspeaker feeds the agent's own TTS straight
// back into the microphone. Browser echoCancellation cannot remove
// loudspeaker echo reliably, so the STT pipeline transcribes the agent's
// voice as "user speech" and the agent replies to itself forever.
//
// The fix is acoustic half-duplex: while the agent is producing audio
// (thinking → speaking, i.e. a reply is being synthesized/played) the mic
// input to STT is suppressed. It is re-armed only a short debounce AFTER the
// agent returns to listening/idle, so the tail of loudspeaker playback (and
// room reverb) cannot re-trigger STT.
//
// This module is a pure, transport-free decision function so the state
// machine can be unit-tested without a browser, an AudioContext, or a live
// VoiceClient. The Svelte layer owns the timer + the actual mute call.

export type VoiceGateStatus = "idle" | "listening" | "thinking" | "speaking";

export type VoiceGateState = {
  /** True while the agent is producing/among-to-produce audio output. */
  agentActive: boolean;
  /** Whether the mic is currently suppressed from the STT pipeline. */
  micSuppressed: boolean;
  /** Pending re-arm timer id, if a debounce is in flight. */
  rearmTimer: number | null;
};

export type VoiceGateAction =
  | { type: "suppress-mic" }
  | { type: "schedule-rearm"; delayMs: number }
  | { type: "cancel-rearm" }
  | { type: "none" };

/** Default re-arm debounce after the agent stops speaking. Long enough to
 *  outlast loudspeaker decay + room reverb on a phone, short enough that a
 *  real user reply is not clipped. */
export const DEFAULT_REARM_DEBOUNCE_MS = 400;

export function initialVoiceGateState(): VoiceGateState {
  return { agentActive: false, micSuppressed: false, rearmTimer: null };
}

/** Statuses during which the agent is (or is about to be) producing audio.
 *  "thinking" is included: the TTS reply follows immediately, and any mic
 *  audio captured during synthesis is either the user's own trailing echo or
 *  the leading edge of loudspeaker playback — never a wanted new turn. */
export function isAgentAudioActive(status: VoiceGateStatus): boolean {
  return status === "thinking" || status === "speaking";
}

/**
 * Decide the gate transition for a new status. Pure: returns the next state
 * plus the side-effect the caller must perform (suppress mic, schedule the
 * re-arm debounce, or cancel a pending re-arm). The caller performs the mute
 * and owns the timer; on timer fire it calls `rearm()`.
 */
export function onStatusChange(
  state: VoiceGateState,
  status: VoiceGateStatus,
  rearmDebounceMs: number = DEFAULT_REARM_DEBOUNCE_MS,
): { state: VoiceGateState; action: VoiceGateAction } {
  const agentActive = isAgentAudioActive(status);

  if (agentActive) {
    // Agent started (or continues) producing audio: suppress mic now and
    // cancel any pending re-arm so a mid-flight debounce cannot reopen the
    // mic while the loudspeaker is live.
    const next: VoiceGateState = { agentActive: true, micSuppressed: true, rearmTimer: null };
    if (!state.micSuppressed) return { state: next, action: { type: "suppress-mic" } };
    if (state.rearmTimer !== null) return { state: next, action: { type: "cancel-rearm" } };
    return { state: next, action: { type: "none" } };
  }

  // Agent is back to listening/idle. If the mic is suppressed, schedule the
  // debounced re-arm (unless one is already scheduled). Do NOT re-arm
  // immediately: the loudspeaker tail is still decaying.
  if (state.micSuppressed) {
    if (state.rearmTimer !== null) {
      return { state: { ...state, agentActive: false }, action: { type: "none" } };
    }
    return {
      state: { ...state, agentActive: false },
      action: { type: "schedule-rearm", delayMs: rearmDebounceMs },
    };
  }

  return { state: { ...state, agentActive: false }, action: { type: "none" } };
}

/** Apply the re-arm once the debounce timer fires: mic is no longer
 *  suppressed. Returns the next state; the caller unmutes the client. */
export function rearm(state: VoiceGateState): VoiceGateState {
  return { agentActive: state.agentActive, micSuppressed: false, rearmTimer: null };
}

/** Record that a re-arm timer has been scheduled. */
export function withRearmTimer(state: VoiceGateState, timer: number): VoiceGateState {
  return { ...state, rearmTimer: timer };
}
