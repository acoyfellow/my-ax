import assert from "node:assert/strict";
import test from "node:test";
import {
  activeRequestIdOf,
  agentStatusFor,
  classifyFrame,
  hasProducedOutput,
  idleStreamingTurnState,
  isComposerLocked,
  progressEligible,
  transition,
  type StreamingTurnEvent,
  type StreamingTurnFrame,
  type StreamingTurnState,
} from "./streaming-turn-fsm";

const frame = (requestId: string | null, chunkType?: string): StreamingTurnEvent => ({ type: "frame", frame: { requestId, chunkType } });
const done = (requestId: string | null): StreamingTurnEvent => ({ type: "frame", frame: { requestId, done: true } });
const error = (requestId: string | null, message = "boom"): StreamingTurnEvent => ({ type: "frame", frame: { requestId, error: message } });

function activeState(requestId = "r1"): StreamingTurnState {
  return transition(idleStreamingTurnState, { type: "submit", requestId });
}

test("CFSA-651 keeps pre-text progress eligible through reasoning and step-only gaps until text", () => {
  let state = activeState("r1");
  for (const chunkType of ["start", "start-step", "reasoning-delta", "finish-step", "tool-input-available"]) {
    state = transition(state, frame("r1", chunkType));
    assert.equal(state.tag, "active");
    assert.equal(isComposerLocked(state), true);
    assert.equal(agentStatusFor(state), "thinking");
    assert.equal(progressEligible(state), true);
  }

  state = transition(state, frame("r1", "text-delta"));
  assert.equal(state.tag, "active");
  assert.equal(agentStatusFor(state), "running");
  assert.equal(progressEligible(state), false);
});

test("post-text tool and reasoning frames do not re-enter pre-text progress eligibility", () => {
  let state = activeState("r1");
  state = transition(state, frame("r1", "text-delta"));
  assert.equal(progressEligible(state), false);
  state = transition(state, frame("r1", "tool-input-available"));
  assert.equal(progressEligible(state), false);
  state = transition(state, frame("r1", "reasoning-delta"));
  assert.equal(progressEligible(state), false);
  assert.equal(agentStatusFor(state), "running");
});

test("tool-only output is valid output and empty completed turns remain detectable", () => {
  let toolOnly = activeState("tool-only");
  toolOnly = transition(toolOnly, frame("tool-only", "tool-input-available"));
  toolOnly = transition(toolOnly, frame("tool-only", "tool-output-available"));
  toolOnly = transition(toolOnly, done("tool-only"));
  assert.equal(toolOnly.tag, "terminal");
  assert.equal(hasProducedOutput(toolOnly), true);

  const empty = transition(activeState("empty"), done("empty"));
  assert.equal(empty.tag, "terminal");
  assert.equal(hasProducedOutput(empty), false);
});

test("restored history fails open while active replay still owns settlement", () => {
  const restored = transition(idleStreamingTurnState, { type: "restore", requestId: "r1" });
  assert.equal(restored.tag, "active");
  assert.equal(transition(restored, { type: "history-loaded" }).tag, "idle");

  const replaying = transition(restored, { type: "resume-requested", requestId: "r1" });
  assert.equal(replaying.tag, "active");
  const afterHistory = transition(replaying, { type: "history-loaded" });
  assert.equal(afterHistory.tag, "active");
  assert.equal(isComposerLocked(afterHistory), true);
});

test("stale restored turns and resume-none interrupt and unlock", () => {
  let state = transition(idleStreamingTurnState, { type: "restore", requestId: "r1" });
  state = transition(state, { type: "resume-requested", requestId: "r1" });
  state = transition(state, { type: "resume-timeout", requestId: "r1" });
  assert.deepEqual(state, { tag: "interrupted", requestId: "r1", reason: "stale-restore" });
  assert.equal(isComposerLocked(state), false);

  let none = transition(idleStreamingTurnState, { type: "submit", requestId: "r2" });
  none = transition(none, { type: "resume-none", requestId: null });
  assert.deepEqual(none, { tag: "interrupted", requestId: "r2", reason: "resume-none" });
  assert.equal(isComposerLocked(none), false);
});

test("voice/adoptable turns can stream from idle without localStorage assumptions", () => {
  let state = transition(idleStreamingTurnState, frame("voice-1", "text-delta"));
  assert.equal(state.tag, "active");
  assert.equal(activeRequestIdOf(state), "voice-1");
  assert.equal(agentStatusFor(state), "running");
  assert.equal(hasProducedOutput(state), true);
  state = transition(state, done("voice-1"));
  assert.equal(state.tag, "terminal");
  assert.equal(agentStatusFor(state), "done");
});

test("terminal and interrupted states are monotonic and absorbing for late frames", () => {
  let failed = transition(activeState("r1"), error("r1", "first failure"));
  failed = transition(failed, done("r1"));
  assert.deepEqual(failed, { tag: "terminal", outcome: "error", requestId: "r1", error: "first failure", producedVisibleText: false, producedToolOutput: false });

  let completed = transition(activeState("r2"), done("r2"));
  completed = transition(completed, frame("r2", "text-delta"));
  assert.equal(completed.tag, "terminal");
  assert.equal(completed.outcome, "completed");

  let interrupted = transition(activeState("r3"), { type: "resume-timeout", requestId: "r3" });
  interrupted = transition(interrupted, done("r3"));
  assert.deepEqual(interrupted, { tag: "interrupted", requestId: "r3", reason: "stale-restore" });
  interrupted = transition(interrupted, error("r3"));
  assert.deepEqual(interrupted, { tag: "interrupted", requestId: "r3", reason: "stale-restore" });
});

test("request-id matrix settles only same-id terminal frames", () => {
  for (const [label, event, settles] of [
    ["same done", done("r1"), true],
    ["same error", error("r1"), true],
    ["null done", done(null), false],
    ["null error", error(null), false],
    ["different done", done("other"), false],
    ["different error", error("other"), false],
  ] as const) {
    const next = transition(activeState("r1"), event);
    assert.equal(next.tag === "terminal", settles, label);
  }

  assert.equal(transition(idleStreamingTurnState, done(null)).tag, "idle");
  assert.equal(transition(idleStreamingTurnState, error(null)).tag, "idle");
  assert.equal(transition(idleStreamingTurnState, done("foreign")).tag, "idle");
  assert.equal(transition(idleStreamingTurnState, error("foreign")).tag, "idle");
});

test("classifyFrame accounts for terminality and adoption", () => {
  const active = activeState("r1");
  assert.equal(classifyFrame(active, { requestId: "r1", chunkType: "text-delta" }), "same");
  assert.equal(classifyFrame(active, { requestId: null, chunkType: "text-delta" }), "null-id");
  assert.equal(classifyFrame(active, { requestId: "r2", chunkType: "text-delta" }), "different");
  assert.equal(classifyFrame(idleStreamingTurnState, { requestId: "voice", chunkType: "text-delta" }), "adoptable");
  assert.equal(classifyFrame(idleStreamingTurnState, { requestId: "voice", done: true }), "different");
  assert.equal(classifyFrame(idleStreamingTurnState, { requestId: null, done: true }), "null-id");
});

test("active turn cannot be clobbered by new submit/restore/adopt/server-resumable events", () => {
  const state = transition(transition(activeState("r1"), frame("r1", "text-delta")), frame("r1", "tool-output-available"));
  for (const event of [
    { type: "submit", requestId: "r2" },
    { type: "restore", requestId: "r2" },
    { type: "adopt", requestId: "r2" },
    { type: "server-resumable", requestId: "r2" },
  ] satisfies StreamingTurnEvent[]) {
    assert.deepEqual(transition(state, event), state);
  }
});

test("visibility-stale clears recovery flags but remains active for adapter re-request", () => {
  let state = transition(activeState("r1"), { type: "resume-requested", requestId: "r1" });
  assert.equal(state.tag, "active");
  assert.equal(state.recoveryPending, true);
  state = transition(state, { type: "visibility-stale" });
  assert.equal(state.tag, "active");
  assert.equal(state.recoveryPending, false);
  assert.equal(state.replaying, false);
  assert.equal(isComposerLocked(state), true);
});

test("reset and session-switch unlock from every representative state", () => {
  for (const state of representativeStates()) {
    assert.equal(isComposerLocked(transition(state, { type: "reset" })), false, state.tag);
    assert.equal(isComposerLocked(transition(state, { type: "session-switch" })), false, state.tag);
  }
});

test("transition is total over representative states and events", () => {
  for (const state of representativeStates()) {
    for (const event of representativeEvents()) {
      assert.doesNotThrow(() => transition(state, event), `${state.tag} + ${event.type}`);
    }
  }
});

function representativeStates(): StreamingTurnState[] {
  const base = activeState("r1");
  const states: StreamingTurnState[] = [
    idleStreamingTurnState,
    base,
    transition(idleStreamingTurnState, { type: "restore", requestId: "r1" }),
    transition(idleStreamingTurnState, { type: "server-resumable", requestId: "r1" }),
    transition(idleStreamingTurnState, { type: "adopt", requestId: "r1" }),
    transition(base, frame("r1", "text-delta")),
    transition(base, frame("r1", "reasoning-delta")),
    transition(base, frame("r1", "tool-input-available")),
    transition(base, frame("r1", "tool-output-available")),
    transition(base, frame("r1", "start-step")),
    transition(base, { type: "resume-timeout", requestId: "r1" }),
    transition(base, { type: "resume-none", requestId: "r1" }),
    transition(base, done("r1")),
    transition(base, error("r1")),
  ];
  return states;
}

function representativeEvents(): StreamingTurnEvent[] {
  const frames: StreamingTurnFrame[] = [
    { requestId: "r1", chunkType: "text-delta" },
    { requestId: null, chunkType: "reasoning-delta" },
    { requestId: "other", chunkType: "tool-input-available" },
    { requestId: "r1", chunkType: "tool-output-available" },
    { requestId: "r1", chunkType: "start" },
    { requestId: "r1", chunkType: "finish" },
    { requestId: "r1", replayComplete: true },
    { requestId: "r1", done: true },
    { requestId: null, done: true },
    { requestId: "other", done: true },
    { requestId: "r1", error: "boom", done: true },
    { requestId: null, error: "boom" },
    { requestId: "other", error: "boom" },
  ];
  return [
    { type: "submit", requestId: "r1" },
    { type: "submit", requestId: "other" },
    { type: "restore", requestId: "r1" },
    { type: "server-resumable", requestId: "r1" },
    { type: "server-resumable", requestId: "other" },
    { type: "adopt", requestId: "voice" },
    { type: "resume-requested", requestId: "r1" },
    { type: "resume-timeout", requestId: "r1" },
    { type: "resume-none", requestId: null },
    { type: "resume-none", requestId: "other" },
    { type: "history-loaded" },
    { type: "visibility-stale" },
    { type: "connection-close" },
    { type: "reset" },
    { type: "session-switch" },
    ...frames.map((candidate) => ({ type: "frame" as const, frame: candidate })),
  ];
}
