import assert from "node:assert/strict";
import test from "node:test";
import { prClosesIssue } from "./ports";

test("a PR body that only narrates a past close does not own the issue", () => {
  const body = "Factory sweep closed #231 onto #235 after that PR was already closed.";
  assert.equal(prClosesIssue(231, "fix: do not close issues onto a dead PR", body, "bot/fix-factory-close-to-pr"), false);
});

test("a real Closes keyword on its own line still owns the issue", () => {
  assert.equal(prClosesIssue(231, "fix: refuse parent-only delegate tasks", "Closes #231\n\nThe child has no workspace.", "bot/issue-231"), true);
});

test("the issue branch name still owns the issue", () => {
  assert.equal(prClosesIssue(231, "wip", "no keyword", "bot/issue-231"), true);
});
