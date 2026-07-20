// Pure watch-stream state machine (#1 Tier-0 "watch my camera"). The Svelte
// layer owns the camera, the <video>/<canvas>, the actual frame capture, and
// the actual turn submit; this module holds the testable timing/bounding logic
// so a hands-off "watch every N seconds -> vision turn" loop stays bounded and
// never stacks turns. No DOM, no timers, no device access here — the caller
// drives ticks and reports whether a turn is in flight.
//
// Why bounded: each captured frame is a real vision model turn, which costs
// tokens. An unbounded loop left running would burn tokens indefinitely, so the
// machine hard-stops after MAX_CAPTURES and the owner must explicitly restart.

/** Default cadence between capture attempts. */
export const DEFAULT_INTERVAL_MS = 15_000;

/** Hard cap on captures per watch session. At 15s cadence that's ~5 minutes of
 *  watching before the owner must restart — a deliberate runaway-token guard. */
export const MAX_CAPTURES = 20;

/** The prompt sent with each watched frame. Short, steer-able, and honest about
 *  the loop so the model knows it is one frame in an ongoing watch. */
export const WATCH_PROMPT =
  "This is a live frame from my camera (automatic watch mode). Briefly tell me anything notable or changed; say \"nothing notable\" if not.";

export type WatchState = {
  /** Watching = the loop is armed and ticking. */
  active: boolean;
  /** How many frames have been captured+submitted this session. */
  captures: number;
  /** Milliseconds between tick attempts. */
  intervalMs: number;
  /** Why the loop stopped, when it is not active. */
  stoppedReason: "idle" | "owner" | "max-captures" | "camera-off";
};

export function initialWatchState(intervalMs: number = DEFAULT_INTERVAL_MS): WatchState {
  return { active: false, captures: 0, intervalMs, stoppedReason: "idle" };
}

/** Start (or restart) a watch session. Resets the capture counter. */
export function startWatch(state: WatchState): WatchState {
  return { ...state, active: true, captures: 0, stoppedReason: "idle" };
}

/** Owner explicitly stops the watch. */
export function stopWatch(state: WatchState, reason: WatchState["stoppedReason"] = "owner"): WatchState {
  if (!state.active) return state;
  return { ...state, active: false, stoppedReason: reason };
}

/** Decision for one tick of the loop. `capture` is true only when the caller
 *  should grab a frame and submit a turn right now. Pure — the caller passes
 *  the current world (turn in flight? camera on?) and applies the returned
 *  state. */
export type TickDecision = { state: WatchState; capture: boolean };

export function onTick(
  state: WatchState,
  world: { turnInFlight: boolean; cameraOn: boolean },
): TickDecision {
  // Not watching: nothing happens.
  if (!state.active) return { state, capture: false };
  // Camera went away underneath us: stop cleanly, do not capture.
  if (!world.cameraOn) return { state: stopWatch(state, "camera-off"), capture: false };
  // A turn is still running: skip this tick entirely so watch turns never
  // stack up behind a slow model response. The counter does NOT advance.
  if (world.turnInFlight) return { state, capture: false };
  // Reached the hard cap already: stop, do not capture.
  if (state.captures >= MAX_CAPTURES) return { state: stopWatch(state, "max-captures"), capture: false };
  // Capture this frame. Advance the counter; if that was the last allowed
  // capture, disarm so the loop won't fire again until the owner restarts.
  const captures = state.captures + 1;
  const reachedCap = captures >= MAX_CAPTURES;
  return {
    state: { ...state, captures, active: !reachedCap, stoppedReason: reachedCap ? "max-captures" : "idle" },
    capture: true,
  };
}

/** Human-readable active label for the UI, e.g. "Watching · 3/20". */
export function watchLabel(state: WatchState): string {
  if (!state.active) return "Watch";
  return `Watching · ${state.captures}/${MAX_CAPTURES}`;
}
