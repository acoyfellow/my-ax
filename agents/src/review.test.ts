import assert from "node:assert/strict";
import test from "node:test";
import { assertNoMergeAction } from "./policy";
import { formatReviewComment, isOwnerPr, reviewPull, runReview } from "./review";
import type { GithubPort } from "./orchestrate";

function github(): GithubPort & { actions: string[] } {
  const actions: string[] = [];
  return {
    actions,
    async labelIssue() {},
    async comment(_n, body) { actions.push(`comment:${body.split("\n")[0]}`); },
    async openReadyPr() { return { number: 1 }; },
    async mergePr() { throw new Error("forbidden GitHub action: merge"); },
    async approvePr() { throw new Error("forbidden GitHub action: approve"); },
    async closePr() { actions.push("close"); },
    async requestChanges() { actions.push("request-changes"); },
  };
}

test("foreign PRs are ignored", () => {
  const receipt = reviewPull({ title: "feat", body: "", author: "kale-stew", draft: true, headSha: "abc" });
  assert.equal(receipt.decision, "ignore");
  assert.equal(isOwnerPr({ author: "kale-stew" }), false);
  assert.equal(isOwnerPr({ author: "acoyfellow" }), true);
  assert.equal(isOwnerPr({ author: "bot", head: "bot/issue-61" }), true);
});

test("auto-error flood PRs are closed", async () => {
  const port = github();
  const receipt = await runReview({
    number: 99,
    title: "bug: Invalid URL string.",
    body: "## Auto error report\nfingerprint: x",
    author: "acoyfellow",
    draft: false,
    headSha: "abc",
  }, { github: port });
  assert.equal(receipt.decision, "close");
  assert.ok(port.actions.includes("close"));
  assert.ok(port.actions.some((a) => a.startsWith("comment:")));
});

test("failed proof requests changes and never approves", async () => {
  const port = github();
  const receipt = await runReview({
    number: 61,
    title: "feat: file one GitHub issue per live error",
    body: "proof",
    author: "acoyfellow",
    draft: false,
    headSha: "abc",
    proofExit: 1,
    proofLog: "not ok",
  }, { github: port });
  assert.equal(receipt.decision, "request-changes");
  assert.ok(port.actions.includes("request-changes"));
  assert.throws(() => assertNoMergeAction("approve"));
  assert.throws(() => assertNoMergeAction("merge"));
  assert.match(formatReviewComment(receipt), /neverApprove: true/);
});

test("passing owner proof is ready for owner, not approved", async () => {
  const receipt = reviewPull({
    title: "fix: junk URL",
    body: "proof",
    author: "acoyfellow",
    draft: false,
    headSha: "abc",
    proofExit: 0,
  });
  assert.equal(receipt.decision, "ready-for-owner");
  assert.equal(receipt.neverApprove, true);
  assert.equal(receipt.neverMerge, true);
});
