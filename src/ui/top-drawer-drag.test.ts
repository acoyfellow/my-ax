import assert from "node:assert/strict";
import test from "node:test";
import { dragOffset, settlesOpen } from "./top-drawer-drag";

test("pulling down from the root button reveals the drawer, clamped to its height", () => {
  assert.equal(dragOffset(10, 210, 600, "open"), 200);
  assert.equal(dragOffset(10, 5, 600, "open"), 0);
  assert.equal(dragOffset(10, 900, 600, "open"), 600);
});

test("pushing the handle up closes the drawer from fully open", () => {
  assert.equal(dragOffset(600, 500, 600, "close"), 500);
  assert.equal(dragOffset(600, 700, 600, "close"), 600);
});

test("the drawer settles open past 70 percent and closed below it", () => {
  assert.equal(settlesOpen(450, 600), true);
  assert.equal(settlesOpen(300, 600), false);
  assert.equal(settlesOpen(0, 0), false);
});
