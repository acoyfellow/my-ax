import assert from "node:assert/strict";
import { test } from "node:test";
import { alignTrailing } from "./attachment-alignment";

test("aligns a single attachment set to a single user message", () => {
  assert.deepEqual(alignTrailing([["a"]], 1), [["a"]]);
});

test("aligns the newest sets to the newest messages when history is truncated", () => {
  assert.deepEqual(alignTrailing([["old"], ["mid"], ["new"]], 2), [["mid"], ["new"]]);
});

test("leaves older messages undefined when fewer sets are known", () => {
  assert.deepEqual(alignTrailing([["new"]], 3), [undefined, undefined, ["new"]]);
});

test("returns nothing when there are no user messages", () => {
  assert.deepEqual(alignTrailing([["a"]], 0), []);
  assert.deepEqual(alignTrailing([], 0), []);
});

test("keeps empty attachment sets distinct from missing ones", () => {
  assert.deepEqual(alignTrailing([[], ["b"]], 2), [[], ["b"]]);
});

test("never misattributes an attachment to an older message", () => {
  const aligned = alignTrailing([["only"]], 4);
  assert.equal(aligned[3]?.[0], "only");
  assert.deepEqual(aligned.slice(0, 3), [undefined, undefined, undefined]);
});
