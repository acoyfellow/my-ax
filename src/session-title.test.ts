import assert from "node:assert/strict";
import test from "node:test";
import { deriveSessionTitle } from "./session-title";
import { SCHEDULED_JOB_RUN_PREFIX } from "./jobs";

test("scheduled job guard prefix is stripped from session and notification titles", () => {
  const title = deriveSessionTitle(`${SCHEDULED_JOB_RUN_PREFIX}\n\nEvery 5 minutes, check on the Lee cmux PR exchange and ALWAYS notify.`);
  assert.equal(title, "Every 5 minutes, check on the Lee cmux PR exchange and ALWAYS notify.");
});

test("normal title derivation still strips code blocks and compresses whitespace", () => {
  const title = deriveSessionTitle("Here is code:\n```ts\nconst secret = 1\n```\n\nThen explain   the result.");
  assert.equal(title, "Here is code: Then explain the result.");
});

test("title truncation never splits a supplementary character into a lone surrogate", () => {
  const title = deriveSessionTitle("a".repeat(199) + "😀tail");
  assert.equal(title, "a".repeat(199) + "😀");
  assert.equal(/[\uD800-\uDBFF]$/.test(title), false, "must not end on a dangling high surrogate");
});
