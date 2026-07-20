import assert from "node:assert/strict";
import test from "node:test";
import {
  initialWatchState,
  startWatch,
  stopWatch,
  onTick,
  watchLabel,
  MAX_CAPTURES,
  DEFAULT_INTERVAL_MS,
  WATCH_PROMPT,
  type WatchState,
} from "./watch-stream";

test("initial state is idle, not active, zero captures", () => {
  const s = initialWatchState();
  assert.equal(s.active, false);
  assert.equal(s.captures, 0);
  assert.equal(s.intervalMs, DEFAULT_INTERVAL_MS);
  assert.equal(s.stoppedReason, "idle");
});

test("startWatch arms the loop and resets the counter", () => {
  let s = initialWatchState();
  s = { ...s, captures: 7 };
  s = startWatch(s);
  assert.equal(s.active, true);
  assert.equal(s.captures, 0);
});

test("a tick while active + camera on + no turn in flight captures and advances", () => {
  const s = startWatch(initialWatchState());
  const { state, capture } = onTick(s, { turnInFlight: false, cameraOn: true });
  assert.equal(capture, true);
  assert.equal(state.captures, 1);
  assert.equal(state.active, true);
});

test("a tick while NOT active never captures", () => {
  const s = initialWatchState();
  const { state, capture } = onTick(s, { turnInFlight: false, cameraOn: true });
  assert.equal(capture, false);
  assert.equal(state.captures, 0);
});

test("a turn in flight skips the tick without advancing the counter (never stack turns)", () => {
  const s = startWatch(initialWatchState());
  const { state, capture } = onTick(s, { turnInFlight: true, cameraOn: true });
  assert.equal(capture, false);
  assert.equal(state.captures, 0);
  assert.equal(state.active, true); // still armed, just skipped
});

test("camera going off underneath the loop stops it cleanly, no capture", () => {
  const s = startWatch(initialWatchState());
  const { state, capture } = onTick(s, { turnInFlight: false, cameraOn: false });
  assert.equal(capture, false);
  assert.equal(state.active, false);
  assert.equal(state.stoppedReason, "camera-off");
});

test("bounded runaway guard: loop hard-stops at MAX_CAPTURES and disarms", () => {
  let s = startWatch(initialWatchState());
  let captured = 0;
  // Drive far more ticks than the cap; only MAX_CAPTURES should fire.
  for (let i = 0; i < MAX_CAPTURES + 10; i++) {
    const d = onTick(s, { turnInFlight: false, cameraOn: true });
    s = d.state;
    if (d.capture) captured++;
  }
  assert.equal(captured, MAX_CAPTURES);
  assert.equal(s.active, false);
  assert.equal(s.stoppedReason, "max-captures");
});

test("the final allowed capture disarms the loop in the same tick", () => {
  let s = startWatch(initialWatchState());
  s = { ...s, captures: MAX_CAPTURES - 1 };
  const { state, capture } = onTick(s, { turnInFlight: false, cameraOn: true });
  assert.equal(capture, true); // the last one still fires
  assert.equal(state.captures, MAX_CAPTURES);
  assert.equal(state.active, false); // but the loop is now disarmed
  assert.equal(state.stoppedReason, "max-captures");
});

test("skipped ticks (turn in flight) do not consume the capture budget", () => {
  let s = startWatch(initialWatchState());
  // 100 ticks all skipped because a turn is always in flight.
  for (let i = 0; i < 100; i++) s = onTick(s, { turnInFlight: true, cameraOn: true }).state;
  assert.equal(s.captures, 0);
  assert.equal(s.active, true);
  // Now a clear tick captures normally.
  const { capture, state } = onTick(s, { turnInFlight: false, cameraOn: true });
  assert.equal(capture, true);
  assert.equal(state.captures, 1);
});

test("owner stop disarms with reason owner; stopping an idle loop is a no-op", () => {
  const s = startWatch(initialWatchState());
  const stopped = stopWatch(s);
  assert.equal(stopped.active, false);
  assert.equal(stopped.stoppedReason, "owner");
  const idle = initialWatchState();
  assert.equal(stopWatch(idle), idle); // no-op, same object
});

test("restart after max-captures re-arms and zeroes the counter", () => {
  let s = startWatch(initialWatchState());
  for (let i = 0; i < MAX_CAPTURES + 5; i++) s = onTick(s, { turnInFlight: false, cameraOn: true }).state;
  assert.equal(s.active, false);
  s = startWatch(s);
  assert.equal(s.active, true);
  assert.equal(s.captures, 0);
});

test("watchLabel reflects state", () => {
  assert.equal(watchLabel(initialWatchState()), "Watch");
  const s = { ...startWatch(initialWatchState()), captures: 3 } as WatchState;
  assert.equal(watchLabel(s), `Watching · 3/${MAX_CAPTURES}`);
});

test("WATCH_PROMPT is non-empty and mentions it is automatic", () => {
  assert.ok(WATCH_PROMPT.length > 0);
  assert.match(WATCH_PROMPT, /watch|automatic/i);
});
