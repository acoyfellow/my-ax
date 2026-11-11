import assert from "node:assert/strict";
import { test } from "node:test";
import { ARMED_TIMEOUT_MS, CAPTURE_MAX_MS, COOLDOWN_MS, audioMayLeaveDevice, initialGate, stepGate, type GateEvent, type GateSnapshot } from "./voice-gate";

function run(events: GateEvent[], from: GateSnapshot = initialGate()): GateSnapshot {
  return events.reduce(stepGate, from);
}

test("starts off", () => {
  assert.deepEqual(initialGate(), { state: "off", elapsedMs: 0 });
});

test("off ignores everything but enable", () => {
  for (const e of [{ type: "wake" }, { type: "speech-start" }, { type: "speech-end" }, { type: "tick", ms: 100 }, { type: "hidden" }, { type: "disable" }] as GateEvent[]) {
    assert.deepEqual(stepGate(initialGate(), e), { state: "off", elapsedMs: 0 });
  }
  assert.deepEqual(stepGate(initialGate(), { type: "enable" }), { state: "listening", elapsedMs: 0 });
});

test("listening only arms on wake; speech without wake stays listening", () => {
  const l = run([{ type: "enable" }]);
  assert.equal(stepGate(l, { type: "speech-start" }).state, "listening");
  assert.equal(stepGate(l, { type: "tick", ms: 99999 }).state, "listening");
  assert.deepEqual(stepGate(l, { type: "wake" }), { state: "armed", elapsedMs: 0 });
});

test("armed times out back to listening", () => {
  const a = run([{ type: "enable" }, { type: "wake" }]);
  const near = stepGate(a, { type: "tick", ms: ARMED_TIMEOUT_MS - 1 });
  assert.deepEqual(near, { state: "armed", elapsedMs: ARMED_TIMEOUT_MS - 1 });
  assert.deepEqual(stepGate(near, { type: "tick", ms: 1 }), { state: "listening", elapsedMs: 0 });
});

test("armed plus speech-start captures, speech-end cools down, cooldown returns to listening", () => {
  const c = run([{ type: "enable" }, { type: "wake" }, { type: "speech-start" }]);
  assert.deepEqual(c, { state: "capturing", elapsedMs: 0 });
  const d = stepGate(c, { type: "speech-end" });
  assert.deepEqual(d, { state: "cooldown", elapsedMs: 0 });
  assert.equal(stepGate(d, { type: "wake" }).state, "cooldown");
  assert.deepEqual(stepGate(d, { type: "tick", ms: COOLDOWN_MS }), { state: "listening", elapsedMs: 0 });
});

test("capturing is capped", () => {
  const c = run([{ type: "enable" }, { type: "wake" }, { type: "speech-start" }]);
  assert.deepEqual(stepGate(c, { type: "tick", ms: CAPTURE_MAX_MS }), { state: "cooldown", elapsedMs: 0 });
  assert.deepEqual(stepGate(c, { type: "tick", ms: CAPTURE_MAX_MS - 1 }), { state: "capturing", elapsedMs: CAPTURE_MAX_MS - 1 });
});

test("disable and hidden turn it off from any state", () => {
  const states = [run([{ type: "enable" }]), run([{ type: "enable" }, { type: "wake" }]), run([{ type: "enable" }, { type: "wake" }, { type: "speech-start" }]), run([{ type: "enable" }, { type: "wake" }, { type: "speech-start" }, { type: "speech-end" }])];
  for (const s of states) {
    assert.deepEqual(stepGate(s, { type: "disable" }), { state: "off", elapsedMs: 0 });
    assert.deepEqual(stepGate(s, { type: "hidden" }), { state: "off", elapsedMs: 0 });
  }
});

test("enable while on is a no-op", () => {
  const a = run([{ type: "enable" }, { type: "wake" }, { type: "tick", ms: 10 }]);
  assert.deepEqual(stepGate(a, { type: "enable" }), a);
});

test("negative or non-finite ticks are ignored", () => {
  const a = run([{ type: "enable" }, { type: "wake" }]);
  assert.deepEqual(stepGate(a, { type: "tick", ms: -5 }), a);
  assert.deepEqual(stepGate(a, { type: "tick", ms: Number.NaN }), a);
});

test("audio leaves the device only while capturing", () => {
  assert.equal(audioMayLeaveDevice("capturing"), true);
  for (const s of ["off", "listening", "armed", "cooldown"] as const) assert.equal(audioMayLeaveDevice(s), false, s);
});

test("stepGate never mutates its input", () => {
  const a = Object.freeze(run([{ type: "enable" }, { type: "wake" }]));
  stepGate(a, { type: "tick", ms: 10 });
  assert.deepEqual(a, { state: "armed", elapsedMs: 0 });
});
