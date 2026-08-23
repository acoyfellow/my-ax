import test from "node:test";
import assert from "node:assert/strict";
import { previewUrlForPull, isPreviewUrlForPull, previewFindings, type PreviewCheck } from "./preview-check";

import { reviewPull, formatReviewComment } from "./review";

const SUFFIX = ".preview.example";
const url = (n: number) => previewUrlForPull(n, SUFFIX);

const HEAD = "abc1234def5678";
const okProof = { proofExit: 0, proofLog: "# pass everything" };
const owner = { author: "acoyfellow", title: "fix: thing", body: "body", number: 144, head: "bot/issue-143", draft: false, headSha: HEAD, files: [] as string[], behindMain: 0, previewHostSuffix: SUFFIX };

test("a preview URL is derived from the pull number", () => {
  assert.equal(url(144), "https://pr-144.preview.example");
  assert.throws(() => previewUrlForPull(0, SUFFIX));
  assert.throws(() => previewUrlForPull(-3, SUFFIX));
  assert.throws(() => previewUrlForPull(144, ""), /not configured/);
});

test("a preview URL belonging to another pull request is refused", () => {
  assert.equal(isPreviewUrlForPull("https://pr-144.preview.example", 144, SUFFIX), true);
  assert.equal(isPreviewUrlForPull("https://pr-999.preview.example", 144, SUFFIX), false);
  assert.equal(isPreviewUrlForPull("https://preview.example", 144, SUFFIX), false);
  assert.equal(isPreviewUrlForPull("http://pr-144.preview.example", 144, SUFFIX), false);
  assert.equal(isPreviewUrlForPull("https://pr-144.evil.example.com", 144, SUFFIX), false);
  assert.equal(isPreviewUrlForPull("not a url", 144, SUFFIX), false);
});

test("a missing preview blocks the review", () => {
  const result = previewFindings({ number: 144, head: HEAD }, SUFFIX);
  assert.equal(result.ok, false);
  assert.match(result.findings[0], /preview missing/);
});

test("a preview that answers anything but 200 blocks the review", () => {
  const result = previewFindings({ number: 144, head: HEAD, preview: { url: url(144), status: 502, version: HEAD } }, SUFFIX);
  assert.equal(result.ok, false);
  assert.match(result.findings[0], /did not answer 200 \(got 502\)/);
});

test("a preview running a different commit blocks the review", () => {
  const result = previewFindings({ number: 144, head: HEAD, preview: { url: url(144), status: 200, version: "9999999aaaa" } }, SUFFIX);
  assert.equal(result.ok, false);
  assert.match(result.findings[0], /not this head/);
});

test("a preview with no reported version blocks the review", () => {
  const result = previewFindings({ number: 144, head: HEAD, preview: { url: url(144), status: 200 } }, SUFFIX);
  assert.equal(result.ok, false);
  assert.match(result.findings[0], /did not report a deployed version/);
});

test("a healthy preview running this head passes and names the URL", () => {
  const result = previewFindings({ number: 144, head: HEAD, preview: { url: url(144), status: 200, version: HEAD } }, SUFFIX);
  assert.equal(result.ok, true);
  assert.match(result.findings[0], /verified against the live preview for this pull request/);
});

test("review refuses ready-for-owner when the proof passed but the preview is missing", () => {
  const receipt = reviewPull({ ...owner, ...okProof, head: HEAD });
  assert.equal(receipt.decision, "request-changes");
  assert.match(receipt.findings.join(" "), /preview missing/);
});

test("review reaches ready-for-owner only with a verified preview, and records the URL", () => {
  const receipt = reviewPull({
    ...owner,
    ...okProof,
    head: HEAD,
    preview: { url: url(144), status: 200, version: HEAD },
  });
  assert.equal(receipt.decision, "ready-for-owner");
  assert.equal(receipt.neverApprove, true);
  assert.equal(receipt.neverMerge, true);
  assert.match(receipt.findings.join(" "), /verified against the live preview for this pull request/);
});

test("a preview borrowed from another pull request cannot pass the review", () => {
  const receipt = reviewPull({
    ...owner,
    ...okProof,
    head: HEAD,
    preview: { url: url(999), status: 200, version: HEAD },
  });
  assert.equal(receipt.decision, "request-changes");
  assert.match(receipt.findings.join(" "), /does not belong to this pull request/);
});

test("a review receipt naming a preview is still safe to post publicly", () => {
  const receipt = reviewPull({
    ...owner,
    ...okProof,
    head: HEAD,
    preview: { url: url(144), status: 200, version: HEAD },
  });
  assert.doesNotThrow(() => formatReviewComment(receipt), "the receipt must not leak the private host");
  const comment = formatReviewComment(receipt);
  assert.ok(!/cloudflare\.dev/.test(comment), "a public comment must not name the private install");
  assert.match(comment, /verified against the live preview/);
});

test("every preview failure message is safe to post publicly", () => {
  const cases: PreviewCheck[] = [
    { url: url(999), status: 200, version: HEAD },
    { url: url(144), status: 502, version: HEAD },
    { url: url(144), status: 200, version: "9999999aaaa" },
    { url: url(144), status: 200 },
  ];
  for (const preview of cases) {
    const receipt = reviewPull({ ...owner, ...okProof, head: HEAD, preview });
    assert.equal(receipt.decision, "request-changes");
    assert.doesNotThrow(() => formatReviewComment(receipt), `must not leak: ${JSON.stringify(preview)}`);
  }
});
