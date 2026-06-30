import assert from "node:assert/strict";
import test from "node:test";
import { capabilitiesDropped, intersectCapabilities } from "./capability-intersect";

test("intersectCapabilities returns sorted, deduped intersection of caller and declared", () => {
  assert.deepEqual(intersectCapabilities(["workspace.read", "machine.shell"], ["machine.shell", "workspace.read", "machine.shell"]), ["machine.shell", "workspace.read"]);
});

test("intersectCapabilities with empty caller grants returns nothing", () => {
  assert.deepEqual(intersectCapabilities([], ["workspace.read"]), []);
});

test("intersectCapabilities treats undefined caller grants as unrestricted (declared applies)", () => {
  assert.deepEqual(intersectCapabilities(undefined, ["workspace.read"]), ["workspace.read"]);
});

test("intersectCapabilities cannot widen the caller's grants", () => {
  // The snippet declares two; caller granted one. Effective is only the one.
  const effective = intersectCapabilities(["workspace.read"], ["workspace.read", "machine.shell"]);
  assert.deepEqual(effective, ["workspace.read"]);
  assert.ok(!effective.includes("machine.shell"), "snippet's machine.shell must be dropped at run time");
});

test("capabilitiesDropped reports the snippet capabilities the caller did not grant", () => {
  assert.deepEqual(capabilitiesDropped(["workspace.read"], ["workspace.read", "machine.shell"]), ["machine.shell"]);
  assert.deepEqual(capabilitiesDropped(undefined, ["workspace.read"]), []);
});
