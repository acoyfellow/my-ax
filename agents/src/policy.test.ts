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
import { runAudit, runTriage, type GithubPort, type TerrariumPort } from "./orchestrate";
import { executeTriageWorkflow } from "./workflows";

function memoryGithub(): GithubPort & { actions: string[] } {
  const actions: string[] = [];
  return {
    actions,
    async labelIssue(_n, labels) { actions.push(`label:${labels.join(",")}`); },
    async comment() { actions.push("comment"); },
    async openDraftPr() { actions.push("draft"); return { number: 7 }; },
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

test("spray never drafts", async () => {
  const github = memoryGithub();
  const steps = await runTriage(
    { title: "docs: add Spanish README", body: "Adds README.es-ES.md", author: "driveby-docs" },
    { github, terrarium: memoryTerrarium(), model: { modelId: "grok-4.6" } },
  );
  assert.equal(steps[0]?.step === "classify" && steps[0].classification.spray, true);
  assert.equal(shouldOpenDraft(steps[0].step === "classify" ? steps[0].classification : classifyIssue({ title: "", body: "", author: "x" })), false);
  assert.ok(!github.actions.includes("draft"));
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
