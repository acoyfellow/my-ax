import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import { auditGithubLayer, runAuditEffect } from "./audit-effect";

const input = {
  number: 42,
  title: "feat",
  body: "",
  author: "maintainer",
  draft: false,
  headSha: "deadbeef",
  files: ["agents/src/policy.ts"],
  behindMain: 0,
};

test("audit Effect stays lazy and posts one unchanged receipt", async () => {
  const comments: Array<{ number: number; body: string }> = [];
  const program = runAuditEffect(input, "agents/audit@test").pipe(Effect.provide(auditGithubLayer({
    comment: async (number, body) => { comments.push({ number, body }); },
  })));

  assert.equal(comments.length, 0);
  const receipt = await Effect.runPromise(program);
  assert.equal(comments.length, 1);
  assert.equal(comments[0]?.number, 42);
  assert.match(comments[0]?.body ?? "", /neverApprove: true/);
  assert.equal(receipt.headSha, "deadbeef");
  assert.equal(receipt.neverApprove, true);
  assert.equal(receipt.neverMerge, true);
});

test("audit Effect fails when its required comment is rejected", async () => {
  const program = runAuditEffect(input, "agents/audit@test").pipe(Effect.provide(auditGithubLayer({
    comment: async () => { throw new Error("comment unavailable"); },
  })));

  await assert.rejects(() => Effect.runPromise(program), /AuditCommentError|comment unavailable/);
});
