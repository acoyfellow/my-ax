import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./worker.ts", import.meta.url), "utf8");

test("issue_comment ignores loop-board comments", () => {
  assert.match(source, /reason: "loop-board"/);
  assert.match(source, /## loop board/);
});

test("issue_comment requires the opt-in token on the new comment, not the issue body", () => {
  assert.match(source, /test\(commentBody\)/);
  assert.doesNotMatch(source, /const text = `\$\{issue\.body/);
});
