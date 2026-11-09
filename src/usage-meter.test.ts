import assert from "node:assert/strict";
import { test } from "node:test";
import { meterEnabled, writeUsage } from "./usage-meter";

function fakeBinding() {
  const points: Array<{ blobs: string[]; doubles?: number[]; indexes?: string[] }> = [];
  return { points, writeDataPoint: (point: { blobs: string[]; doubles?: number[]; indexes?: string[] }) => { points.push(point); } };
}

test("meter is off unless explicitly enabled, and writes nothing when off", () => {
  const binding = fakeBinding();
  assert.equal(meterEnabled({}), false);
  assert.equal(meterEnabled({ USAGE_METER_ENABLED: "0" }), false);
  assert.equal(writeUsage({ USAGE: binding }, { name: "session_created", owner: "o@x", sessionId: "s1" }), false);
  assert.deepEqual(binding.points, []);
});

test("meter writes the event with owner and session when enabled", () => {
  const binding = fakeBinding();
  assert.equal(writeUsage({ USAGE: binding, USAGE_METER_ENABLED: "1" }, { name: "message_injected", owner: "o@x", sessionId: "s1", value: 2 }), true);
  assert.equal(binding.points.length, 1);
  assert.deepEqual(binding.points[0].blobs, ["message_injected", "o@x", "s1"]);
  assert.deepEqual(binding.points[0].doubles, [2]);
});

test("meter defaults the count to one", () => {
  const binding = fakeBinding();
  writeUsage({ USAGE: binding, USAGE_METER_ENABLED: "1" }, { name: "session_created", owner: "o@x", sessionId: "s1" });
  assert.deepEqual(binding.points[0].doubles, [1]);
});

test("meter writes nothing when the binding is absent", () => {
  assert.equal(writeUsage({ USAGE_METER_ENABLED: "1" }, { name: "session_created", owner: "o@x", sessionId: "s1" }), false);
});
