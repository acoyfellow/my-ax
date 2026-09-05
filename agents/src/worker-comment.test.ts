import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./worker.ts", import.meta.url), "utf8");

test("issue_comment ignores factory status comments", () => {
  assert.match(source, /reason: "factory-status"/);
  assert.match(source, /Factory status/);
});

test("issue_comment requires the opt-in token on the new comment, not the issue body", () => {
  assert.match(source, /test\(commentBody\)/);
  assert.doesNotMatch(source, /const text = `\$\{issue\.body/);
});

test("a closed unmerged factory PR resets its carrier", () => {
  assert.match(source, /action === "closed"/);
  assert.match(source, /carrier-reset/);
  assert.match(source, /deleteBranch/);
  assert.match(source, /reopenIssue/);
});

test("worker has a scheduled sweep entry", () => {
  assert.match(source, /async scheduled/);
  assert.match(source, /runIssueSweep/);
});
