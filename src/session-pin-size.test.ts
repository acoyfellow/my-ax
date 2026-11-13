import assert from "node:assert/strict";
import test from "node:test";
import { nextPinSize, parsePinSize, pinSizeOf } from "./session-pin-size";

test("pin size cycles small, wide, large, then back", () => {
  assert.equal(nextPinSize("small"), "medium");
  assert.equal(nextPinSize("medium"), "large");
  assert.equal(nextPinSize("large"), "small");
});

test("unknown sizes are refused on write and read back as small", () => {
  assert.equal(parsePinSize("huge"), null);
  assert.equal(parsePinSize(3), null);
  assert.equal(pinSizeOf(null), "small");
  assert.equal(pinSizeOf("large"), "large");
});
