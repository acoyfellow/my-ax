import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_AGENTS_MODEL,
  acceptVisualProof,
  assertNoMergeAction,
  classifyIssue,
  resolveAgentsModel,
  shouldOpenDraft,
  shouldSpawnDig,
  verifyTerrariumReceipt,
} from "./policy";
import { PROOF_COMMAND, formatReadyPrBody, formatReadyPrTitle, runAudit, runTriage, type GithubPort, type TerrariumPort } from "./orchestrate";
import { executeTriageWorkflow } from "./workflows";

function memoryGithub(): GithubPort & { actions: string[] } {
  const actions: string[] = [];
  return {
    actions,
    async labelIssue(_n, labels) { actions.push(`label:${labels.join(",")}`); },
    async comment() { actions.push("comment"); },
    async openReadyPr(input) { actions.push(`pr:${input.title}`); actions.push(`head:${input.head}`); actions.push(`body:${input.body}`); return { number: 7 }; },
    async mergePr() { actions.push("merge"); },
    async approvePr() { actions.push("approve"); },
  };
}

function memoryTerrarium(ok = true): TerrariumPort {
  return {
    async spawn() { return { runId: "r1", taskFingerprint: "fp1", nonce: "n1" }; },
    async wait() { return { runId: "r1", taskFingerprint: "fp1", nonce: "n1", ok, taskContractStatus: ok ? "proven" : "unproven" }; },
  };
}

test("AGENTS_MODEL defaults to grok-4.6 and is overridable", () => {
  assert.equal(DEFAULT_AGENTS_MODEL, "grok-4.6");
  assert.equal(resolveAgentsModel({}), "grok-4.6");
  assert.equal(resolveAgentsModel({ AGENTS_MODEL: "kimi-k2.7" }), "kimi-k2.7");
});

test("ready PR body names the issue, proof command, and never-merge rule", () => {
  const input = {
    number: 40,
    title: "bug: desk href allowlist untested for // and overlong github URLs",
    body: "triage:draft\nmutant survivors on desk-board",
    author: "owner",
  };
  const classification = classifyIssue(input);
  const body = formatReadyPrBody(input, classification);
  assert.equal(formatReadyPrTitle(input), "fix: desk href allowlist untested for // and overlong github URLs");
  assert.match(body, /Closes #40/);
  assert.match(body, /issues\/40/);
  assert.match(body, new RegExp(PROOF_COMMAND.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(body, /never merges/i);
  assert.match(body, /does not invent a file list/);
  assert.doesNotMatch(body, /src\/desk-board\.ts/);
  assert.doesNotMatch(body, /Machine draft\. Not reviewed/);
  assert.throws(() => formatReadyPrBody({ title: "x", body: "triage:draft", author: "o" }, classification));
});

test("triage:draft still opens a draft when the bug mentions PWA", () => {
  const classified = classifyIssue({
    title: "bug: second device can send while a turn is running",
    body: "triage:draft\nDesktop PWA locks the composer. Phone still allows Send.",
    author: "owner",
  });
  assert.equal(classified.visual, "owner-device");
  assert.equal(classified.draft, true);
  assert.equal(shouldOpenDraft(classified), true);
});

test("spray never drafts", async () => {
  const github = memoryGithub();
  const steps = await runTriage(
    { title: "docs: add Spanish README", body: "Adds README.es-ES.md", author: "driveby-docs" },
    { github, terrarium: memoryTerrarium(), model: { modelId: "grok-4.6" } },
  );
  assert.equal(steps[0]?.step === "classify" && steps[0].classification.spray, true);
  assert.equal(shouldOpenDraft(steps[0].step === "classify" ? steps[0].classification : classifyIssue({ title: "", body: "", author: "x" })), false);
  assert.ok(!github.actions.some((action) => action.startsWith("pr:")));
  assert.ok(github.actions.includes("comment"));
});

test("owner-device hard issue parks instead of pretending the cell can demo", async () => {
  const classified = classifyIssue({ title: "Voice dies after TTS", body: "Needs a cell / terrarium investigation across multiple surfaces for hours.", author: "owner" });
  assert.equal(classified.visual, "owner-device");
  assert.equal(shouldSpawnDig(classified), false);
  const github = memoryGithub();
  const steps = await runTriage(
    { title: "Voice dies after TTS", body: "Needs a cell / terrarium investigation across multiple surfaces for hours.", author: "owner" },
    { github, terrarium: memoryTerrarium(true), model: { modelId: "grok-4.6" } },
  );
  assert.ok(!steps.some((s) => s.step === "dig"));
  assert.ok(github.actions.some((a) => a.includes("needs-owner-video")));
});

test("public-web hard issue requires pixels on the Terrarium receipt", async () => {
  const body = "Needs a cell / terrarium investigation of the More info drawer UI for hours.";
  const classified = classifyIssue({ title: "bug: Drawer never opens", body, author: "owner" });
  assert.equal(classified.visual, "public-web");
  assert.equal(shouldSpawnDig(classified), true);
  const noPixels = await runTriage(
    { title: "bug: Drawer never opens", body, author: "owner" },
    { github: memoryGithub(), terrarium: memoryTerrarium(true), model: { modelId: "grok-4.6" } },
  );
  assert.ok(noPixels.some((s) => s.step === "stop" && s.reason.includes("visual")));
});

test("unproven Terrarium receipt stops the graph", async () => {
  const steps = await runTriage(
    { title: "bug: Drawer never opens", body: "Needs a cell / terrarium investigation of the More info drawer UI for hours.", author: "owner" },
    { github: memoryGithub(), terrarium: memoryTerrarium(false), model: { modelId: "grok-4.6" } },
  );
  assert.ok(steps.some((s) => s.step === "stop" && s.reason.includes("unproven")));
});

test("audit never approves or merges", async () => {
  const github = memoryGithub();
  const receipt = await runAudit(
    { title: "feat(push)", body: "ok", author: "maintainer", draft: false, headSha: "abc", files: ["src/notify.ts"], behindMain: 0 },
    { github, promptDigest: "digest-1" },
  );
  assert.equal(receipt.neverApprove, true);
  assert.equal(receipt.neverMerge, true);
  assert.throws(() => assertNoMergeAction("merge"));
  assert.throws(() => assertNoMergeAction("approve"));
  assert.ok(!github.actions.includes("merge"));
  assert.ok(!github.actions.includes("approve"));
});

test("gateway is required before a workflow runs", async () => {
  await assert.rejects(
    () => executeTriageWorkflow(
      {},
      { title: "x", body: "bug fail", author: "a" },
      { github: memoryGithub(), terrarium: memoryTerrarium() },
    ),
    /LLM_GATEWAY/,
  );
});

test("a PNG URL is not visual proof without a vitest-visual-diff cascade", () => {
  assert.equal(acceptVisualProof("public-web", {
    lane: "public-web",
    kind: "screenshot",
    url: "https://example.test/proof.png",
    bytes: 1200,
  }), false);
  assert.equal(acceptVisualProof("public-web", {
    lane: "public-web",
    kind: "visual-diff",
    engine: "vitest-visual-diff",
    pass: true,
    tiers: { A: true, B: true, C: true },
    url: "https://example.test/diff.png",
  }), true);
});

test("receipt correlation is fail-closed", () => {
  assert.equal(
    verifyTerrariumReceipt(
      { runId: "r1", taskFingerprint: "fp1", nonce: "n1" },
      { runId: "r1", taskFingerprint: "fp1", nonce: "other", ok: true },
    ),
    false,
  );
});
