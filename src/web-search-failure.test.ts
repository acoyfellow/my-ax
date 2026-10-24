import { test } from "node:test";
import assert from "node:assert/strict";
import { describeSearchFailure } from "./web-search-program";

test("a search failure reason keeps the cause and redacts credentials", () => {
  const detail = describeSearchFailure(new Error("quota exceeded; Authorization: Bearer abc123"));
  assert.match(detail, /quota exceeded/);
  assert.doesNotMatch(detail, /abc123/);
});
