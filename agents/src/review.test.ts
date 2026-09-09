import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import { assertNoMergeAction } from "./policy";
import { formatReviewComment, isOwnerPr, reviewPull, type ReviewInput } from "./review";
import { reviewGithubLayer, runReviewEffect } from "./review-effect";
import { assertPublicText } from "./public-text";
import type { GithubPort } from "./orchestrate";

const runReview = (input: ReviewInput, ports: { github: GithubPort }) => Effect.runPromise(
  runReviewEffect(input).pipe(Effect.provide(reviewGithubLayer(ports.github))),
);

function pull(extra: Record<string, unknown> = {}) {
  return {
    title: "feat",
    body: "",
    author: "acoyfellow",
    draft: false,
    headSha: "abc",
    files: [] as string[],
    behindMain: 0,
    ...extra,
  };
}

function github(): GithubPort & { actions: string[] } {
  const actions: string[] = [];
  return {
    actions,
    async labelIssue() {},
    async comment(_n, body) { actions.push(`comment:${body.split("\n")[0]}`); },
    async openReadyPr() { return { number: 1 }; },
    async closePr() { actions.push("close"); },
    async requestChanges() { actions.push("request-changes"); },
  };
}

test("foreign PRs are ignored", () => {
  const receipt = reviewPull(pull({ author: "kale-stew", draft: true }));
  assert.equal(receipt.decision, "ignore");
  assert.equal(isOwnerPr({ author: "kale-stew" }), false);
  assert.equal(isOwnerPr({ author: "acoyfellow" }), true);
  assert.equal(isOwnerPr({ author: "bot", head: "bot/issue-61" }), true);
});

test("review Effect stays lazy and fails when its required comment is rejected", async () => {
  let comments = 0;
  const port = github();
  port.comment = async () => {
    comments += 1;
    throw new Error("comment failed");
  };
  const program = runReviewEffect(pull({ number: 99, proofExit: 1, proofLog: "not ok" })).pipe(
    Effect.provide(reviewGithubLayer(port)),
  );
  assert.equal(comments, 0);
  await assert.rejects(() => Effect.runPromise(program), /ReviewOperationError|comment failed/);
  assert.equal(comments, 1);
});

test("auto-error flood PRs are closed", async () => {
  const port = github();
  const receipt = await runReview(pull({
    number: 99,
    title: "bug: Invalid URL string.",
    body: "## Auto error report\nfingerprint: x",
  }), { github: port });
  assert.equal(receipt.decision, "close");
  assert.ok(port.actions.includes("close"));
  assert.ok(port.actions.some((a) => a.startsWith("comment:")));
});

test("a rejected self-review does not fail the review or duplicate the comment", async () => {
  const port = github();
  port.requestChanges = async () => {
    throw new Error("github /pulls/61/reviews 422");
  };
  const receipt = await runReview(pull({
    number: 61,
    title: "feat: file one GitHub issue per live error",
    body: "proof",
  }), { github: port });
  assert.equal(receipt.decision, "request-changes", "the verdict must still stand");
  const comments = port.actions.filter((a) => a.startsWith("comment:"));
  assert.equal(comments.length, 1, "exactly one review comment, never a retry storm");
});

test("failed proof requests changes and never approves", async () => {
  const port = github();
  const receipt = await runReview(pull({
    number: 61,
    title: "feat: file one GitHub issue per live error",
    body: "proof",
    proofExit: 1,
    proofLog: "not ok",
  }), { github: port });
  assert.equal(receipt.decision, "request-changes");
  assert.ok(port.actions.includes("request-changes"));
  assert.throws(() => assertNoMergeAction("approve"));
  assert.throws(() => assertNoMergeAction("merge"));
  assert.match(formatReviewComment(receipt), /neverApprove: true/);
});

test("passing owner proof with a verified preview is ready for owner, not approved", async () => {
  const receipt = reviewPull(pull({
    number: 144,
    head: "deadbeefcafe",
    title: "fix: junk URL",
    body: "proof",
    proofExit: 0,
    proofLog: "# pass 18\n> tsc --noEmit\n",
    previewHostSuffix: ".preview.example",
    preview: { url: "https://pr-144.preview.example", status: 200, version: "deadbeefcafe" },
  }));
  assert.equal(receipt.decision, "ready-for-owner");
  assert.equal(receipt.neverApprove, true);
  assert.equal(receipt.neverMerge, true);
  assert.equal(assertPublicText(formatReviewComment(receipt)), formatReviewComment(receipt));
});

test("missing proof requests changes", () => {
  const receipt = reviewPull(pull({ title: "fix: junk URL", body: "proof" }));
  assert.equal(receipt.decision, "request-changes");
  assert.match(receipt.findings.join("\n"), /proof missing/);
});

test("a terrarium plan with exit 0 is not proof", () => {
  const receipt = reviewPull(pull({
    title: "fix: junk URL",
    body: "proof",
    proofExit: 0,
    proofLog: "TASK_RECEIVED\nClone the repository and run npm run check\nTASK_ENDED",
  }));
  assert.equal(receipt.decision, "request-changes");
  assert.match(receipt.findings.join("\n"), /no typecheck or test pass/);
});
