import { test } from "node:test";
import assert from "node:assert/strict";
import { distanceFromBottom, isNearBottom, FOLLOW_THRESHOLD_PX } from "./scroll-follow";

test("distance from bottom is what is left below the viewport", () => {
  assert.equal(distanceFromBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 600 }), 0);
  assert.equal(distanceFromBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 100 }), 500);
});

test("within the follow threshold counts as at the bottom", () => {
  assert.equal(isNearBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 600 - FOLLOW_THRESHOLD_PX + 1 }), true);
  assert.equal(isNearBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 600 - FOLLOW_THRESHOLD_PX - 1 }), false);
});
