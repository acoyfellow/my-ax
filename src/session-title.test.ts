import assert from "node:assert/strict";
import test from "node:test";
import { deriveSessionTitle } from "./session-title";
import { SCHEDULED_JOB_RUN_PREFIX } from "./jobs";

test("scheduled job guard prefix is stripped from session and notification titles", () => {
  const title = deriveSessionTitle(`${SCHEDULED_JOB_RUN_PREFIX}\n\nCheck the status.`);
  assert.equal(title, "Check the status.");
});

test("normal title derivation still strips code blocks and compresses whitespace", () => {
  const title = deriveSessionTitle("Here is code:\n```ts\nconst secret = 1\n```\n\nThen explain   the result.");
  assert.equal(title, "Here is code: Then explain the result.");
});

test("title truncation stops at 60 Unicode code points without splitting a supplementary character", () => {
  const title = deriveSessionTitle("a".repeat(59) + "😀tail");
  assert.equal(title, "a".repeat(59) + "😀");
  assert.equal(Array.from(title).length, 60);
  assert.equal(/[\uD800-\uDBFF]$/.test(title), false, "must not end on a dangling high surrogate");
});
