import assert from "node:assert/strict";
import { test } from "node:test";
import { wantsWakeLock } from "../wake-lock";
import { HEARTBEAT_STALE_MS, initialLeader, mirrorIsStale, runsSharedStream, stepLeader } from "./tab-leader";
import { coarsen, decideLocation, locationToast } from "./location";
import { GZIP_MIN_BYTES, gzipPlan } from "./gzip-plan";
import { keyboardInset } from "./keyboard-inset";

const on = { supported: true, enabled: true, visible: true, busy: false, manual: false };

test("wake lock: held while busy or manual, only when supported, enabled and visible", () => {
  assert.equal(wantsWakeLock({ ...on, busy: true }), true);
  assert.equal(wantsWakeLock({ ...on, manual: true }), true);
  assert.equal(wantsWakeLock(on), false);
  assert.equal(wantsWakeLock({ ...on, busy: true, visible: false }), false);
  assert.equal(wantsWakeLock({ ...on, busy: true, enabled: false }), false);
  assert.equal(wantsWakeLock({ ...on, manual: true, supported: false }), false);
});

test("tab leader: starts unknown, lock decides leader or mirror, no locks means solo", () => {
  assert.deepEqual(initialLeader(), { role: "unknown", lastHeartbeat: null });
  assert.equal(stepLeader(initialLeader(), { type: "lock-granted" }).role, "leader");
  assert.equal(stepLeader(initialLeader(), { type: "lock-waiting" }).role, "mirror");
  assert.equal(stepLeader(initialLeader(), { type: "locks-unsupported" }).role, "solo");
});

test("tab leader: a waiting mirror becomes leader when granted; a released leader goes back to unknown", () => {
  const m = stepLeader(initialLeader(), { type: "lock-waiting" });
  assert.equal(stepLeader(m, { type: "lock-granted" }).role, "leader");
  const l = stepLeader(initialLeader(), { type: "lock-granted" });
  assert.deepEqual(stepLeader(l, { type: "lock-released" }), { role: "unknown", lastHeartbeat: null });
});

test("tab leader: mirrors record heartbeats, leaders and solos ignore them", () => {
  const m = stepLeader(stepLeader(initialLeader(), { type: "lock-waiting" }), { type: "leader-heartbeat", at: 1000 });
  assert.equal(m.lastHeartbeat, 1000);
  const older = stepLeader(m, { type: "leader-heartbeat", at: 500 });
  assert.equal(older.lastHeartbeat, 1000);
  const l = stepLeader(stepLeader(initialLeader(), { type: "lock-granted" }), { type: "leader-heartbeat", at: 1000 });
  assert.equal(l.lastHeartbeat, null);
});

test("tab leader: who runs the shared stream", () => {
  assert.equal(runsSharedStream("leader"), true);
  assert.equal(runsSharedStream("solo"), true);
  assert.equal(runsSharedStream("mirror"), false);
  assert.equal(runsSharedStream("unknown"), false);
});

test("tab leader: a mirror is stale when no heartbeat yet or the last one is too old", () => {
  const m = stepLeader(initialLeader(), { type: "lock-waiting" });
  assert.equal(mirrorIsStale(m, 0), true);
  const h = stepLeader(m, { type: "leader-heartbeat", at: 1000 });
  assert.equal(mirrorIsStale(h, 1000 + HEARTBEAT_STALE_MS), false);
  assert.equal(mirrorIsStale(h, 1000 + HEARTBEAT_STALE_MS + 1), true);
  const l = stepLeader(initialLeader(), { type: "lock-granted" });
  assert.equal(mirrorIsStale(l, 999999), false);
});

test("location: rounds to 2 decimals and never claims better than 1 km", () => {
  assert.deepEqual(coarsen({ latitude: 40.712776, longitude: -74.005974, accuracy: 12 }), { latitude: 40.71, longitude: -74.01, accuracyMeters: 1000 });
  assert.deepEqual(coarsen({ latitude: 51.5, longitude: -0.1278, accuracy: 3500.4 }), { latitude: 51.5, longitude: -0.13, accuracyMeters: 3500 });
  assert.deepEqual(coarsen({ latitude: -33.86882, longitude: 151.20929, accuracy: 0 }), { latitude: -33.87, longitude: 151.21, accuracyMeters: 1000 });
});

test("location: read only when enabled and not denied or unsupported", () => {
  assert.equal(decideLocation({ enabled: true, permission: "granted" }).action, "read");
  assert.equal(decideLocation({ enabled: true, permission: "prompt" }).action, "read");
  for (const permission of ["denied", "unsupported"] as const) assert.equal(decideLocation({ enabled: true, permission }).action, "refuse");
  for (const permission of ["granted", "prompt", "denied", "unsupported"] as const) {
    const d = decideLocation({ enabled: false, permission });
    assert.equal(d.action, "refuse");
    assert.ok(d.reason.length > 0);
  }
});

test("location: the toast names the rounded point and accuracy in km", () => {
  assert.equal(locationToast({ latitude: 40.71, longitude: -74.01, accuracyMeters: 1000 }), "Shared your location (40.71, -74.01, about 1 km)");
  assert.equal(locationToast({ latitude: 51.5, longitude: -0.13, accuracyMeters: 3500 }), "Shared your location (51.50, -0.13, about 4 km)");
});

test("gzip: compress text-like content at or above the minimum when supported", () => {
  assert.deepEqual(gzipPlan({ bytes: GZIP_MIN_BYTES, contentType: "application/json", name: "receipt.json", supported: true }), { compress: true, name: "receipt.json.gz", contentType: "application/json", contentEncoding: "gzip" });
  assert.equal(gzipPlan({ bytes: 5000, contentType: "text/plain; charset=utf-8", name: "log.txt", supported: true }).compress, true);
  assert.equal(gzipPlan({ bytes: 5000, contentType: "text/markdown", name: "t.md", supported: true }).compress, true);
  assert.equal(gzipPlan({ bytes: 5000, contentType: "application/x-ndjson", name: "t.ndjson", supported: true }).compress, true);
});

test("gzip: leave small, binary, already-compressed or unsupported content alone", () => {
  const same = (input: Parameters<typeof gzipPlan>[0]) => assert.deepEqual(gzipPlan(input), { compress: false, name: input.name, contentType: input.contentType, contentEncoding: null });
  same({ bytes: GZIP_MIN_BYTES - 1, contentType: "application/json", name: "a.json", supported: true });
  same({ bytes: 9000, contentType: "image/png", name: "a.png", supported: true });
  same({ bytes: 9000, contentType: "application/gzip", name: "a.json.gz", supported: true });
  same({ bytes: 9000, contentType: "application/json", name: "a.json.gz", supported: true });
  same({ bytes: 9000, contentType: "application/json", name: "a.json", supported: false });
});

test("keyboard inset: prefers the virtual keyboard height", () => {
  assert.equal(keyboardInset({ virtualKeyboardHeight: 300, layoutViewportHeight: 800, visualViewportHeight: 500, visualViewportOffsetTop: 0 }), 300);
});

test("keyboard inset: falls back to the visual viewport gap", () => {
  assert.equal(keyboardInset({ virtualKeyboardHeight: null, layoutViewportHeight: 800, visualViewportHeight: 500, visualViewportOffsetTop: 0 }), 300);
  assert.equal(keyboardInset({ virtualKeyboardHeight: 0, layoutViewportHeight: 800, visualViewportHeight: 500, visualViewportOffsetTop: 40 }), 260);
});

test("keyboard inset: never negative, ignores tiny gaps, rounds to whole pixels", () => {
  assert.equal(keyboardInset({ virtualKeyboardHeight: null, layoutViewportHeight: 800, visualViewportHeight: 900, visualViewportOffsetTop: 0 }), 0);
  assert.equal(keyboardInset({ virtualKeyboardHeight: null, layoutViewportHeight: 800, visualViewportHeight: 790, visualViewportOffsetTop: 0 }), 0);
  assert.equal(keyboardInset({ virtualKeyboardHeight: null, layoutViewportHeight: 800, visualViewportHeight: null, visualViewportOffsetTop: null }), 0);
  assert.equal(keyboardInset({ virtualKeyboardHeight: 301.6, layoutViewportHeight: 800, visualViewportHeight: null, visualViewportOffsetTop: null }), 302);
});
