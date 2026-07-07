import assert from "node:assert/strict";
import test from "node:test";
import {
  initialVoiceGateState,
  isAgentAudioActive,
  onStatusChange,
  rearm,
  withRearmTimer,
  DEFAULT_REARM_DEBOUNCE_MS,
  type VoiceGateState,
} from "./voice-half-duplex";

/** Drive the pure gate through a status sequence, performing the actions
 *  against a tiny simulator (mic mute + a manual timer) so we can assert the
 *  exact suppression timeline without a browser. */
function simulate(statuses: Array<{ status: Parameters<typeof onStatusChange>[1]; advanceMs?: number }>, debounce = DEFAULT_REARM_DEBOUNCE_MS) {
  let state: VoiceGateState = initialVoiceGateState();
  let micSuppressed = false;
  let pendingRearm: { fireAt: number } | null = null;
  let now = 0;
  const timeline: Array<{ at: number; status: string; micSuppressed: boolean }> = [];

  const fireDue = () => {
    if (pendingRearm && pendingRearm.fireAt <= now) {
      pendingRearm = null;
      state = rearm(state);
      micSuppressed = false;
    }
  };

  for (const step of statuses) {
    const { state: next, action } = onStatusChange(state, step.status, debounce);
    state = next;
    if (action.type === "suppress-mic") { pendingRearm = null; micSuppressed = true; }
    else if (action.type === "cancel-rearm") { pendingRearm = null; }
    else if (action.type === "schedule-rearm") {
      pendingRearm = { fireAt: now + action.delayMs };
      state = withRearmTimer(state, 1);
    }
    timeline.push({ at: now, status: step.status, micSuppressed });
    if (step.advanceMs) { now += step.advanceMs; fireDue(); }
  }
  return { micSuppressed, pendingRearm, timeline };
}

test("agent audio-active statuses are thinking and speaking", () => {
  assert.equal(isAgentAudioActive("thinking"), true);
  assert.equal(isAgentAudioActive("speaking"), true);
  assert.equal(isAgentAudioActive("listening"), false);
  assert.equal(isAgentAudioActive("idle"), false);
});

test("mic is suppressed the instant the agent starts thinking/speaking", () => {
  const { timeline } = simulate([
    { status: "listening" },
    { status: "thinking" },
    { status: "speaking" },
  ]);
  assert.equal(timeline[0].micSuppressed, false, "listening: mic open");
  assert.equal(timeline[1].micSuppressed, true, "thinking: mic suppressed");
  assert.equal(timeline[2].micSuppressed, true, "speaking: mic stays suppressed");
});

test("feedback loop is broken: mic stays suppressed through the whole reply and only re-arms after the debounce", () => {
  // The exact bug scenario: user speaks, agent thinks+speaks (loudspeaker),
  // returns to listening. The mic must NOT be open during playback, and must
  // stay closed until the debounce elapses so the loudspeaker tail cannot
  // re-trigger STT.
  const result = simulate([
    { status: "listening" },              // user just finished; mic open
    { status: "thinking", advanceMs: 200 },  // agent composing reply
    { status: "speaking", advanceMs: 3000 }, // TTS playing out loudspeaker
    { status: "listening", advanceMs: 200 }, // playback done; debounce starts (400ms)
  ]);
  // 200ms after playback ended is still inside the 400ms debounce.
  assert.equal(result.micSuppressed, true, "mic must remain suppressed within the debounce window");
  assert.ok(result.pendingRearm, "a re-arm must be pending, not immediate");
});

test("mic re-arms once the debounce fully elapses after playback", () => {
  const result = simulate([
    { status: "speaking", advanceMs: 1000 },
    { status: "listening", advanceMs: DEFAULT_REARM_DEBOUNCE_MS + 1 },
  ]);
  assert.equal(result.micSuppressed, false, "mic re-armed after the debounce");
  assert.equal(result.pendingRearm, null, "no pending re-arm remains");
});

test("agent resuming audio before the debounce fires cancels the re-arm and keeps the mic shut", () => {
  const result = simulate([
    { status: "speaking", advanceMs: 500 },
    { status: "listening", advanceMs: 100 }, // debounce scheduled (400ms), only 100ms passes
    { status: "speaking", advanceMs: 2000 }, // agent speaks again before re-arm — cancel it
    { status: "listening", advanceMs: 100 }, // new debounce, still pending
  ]);
  assert.equal(result.micSuppressed, true, "mic must not have re-armed across the interrupted debounce");
  assert.ok(result.pendingRearm, "a fresh debounce is pending after the second reply");
});

test("repeated listening statuses do not schedule a second overlapping debounce", () => {
  let state = initialVoiceGateState();
  ({ state } = onStatusChange(state, "speaking"));
  const first = onStatusChange(state, "listening");
  state = first.state;
  assert.equal(first.action.type, "schedule-rearm");
  state = withRearmTimer(state, 1);
  const second = onStatusChange(state, "listening");
  assert.equal(second.action.type, "none", "a second listening must not schedule another timer");
});

test("gate is inert when the agent never produced audio (mic already open)", () => {
  const { timeline, micSuppressed } = simulate([
    { status: "idle" },
    { status: "listening" },
    { status: "listening" },
  ]);
  assert.equal(micSuppressed, false);
  assert.ok(timeline.every((t) => t.micSuppressed === false));
});

test("default debounce is within the required 300-500ms band", () => {
  assert.ok(DEFAULT_REARM_DEBOUNCE_MS >= 300 && DEFAULT_REARM_DEBOUNCE_MS <= 500);
});
