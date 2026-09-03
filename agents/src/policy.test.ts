import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_AGENTS_MODEL,
  acceptVisualProof,
  assertNoMergeAction,
  auditPull,
  classifyIssue,
  requireTaskProof,
  resolveAgentsModel,
  shouldOpenDraft,
  shouldSpawnDig,
  usableIssueLabels,
  verifyTerrariumReceipt,
} from "./policy";
import { PROOF_COMMAND, formatLoopBoard, formatReadyPrBody, formatReadyPrTitle, runAudit, runTriage, type GithubPort, type TerrariumPort } from "./orchestrate";
import { executeTriageWorkflow } from "./workflows";

function memoryGithub(): GithubPort & { actions: string[]; comments: string[] } {
  const actions: string[] = [];
  const comments: string[] = [];
  return {
    actions,
    comments,
    async labelIssue(_n, labels) { actions.push(`label:${labels.join(",")}`); },
    async comment(_n, body) { actions.push("comment"); comments.push(body); },
    async listComments() { return comments; },
    async openReadyPr(input) { actions.push(`pr:${input.title}`); actions.push(`head:${input.head}`); actions.push(`body:${input.body}`); return { number: 7 }; },
    async hasBranch(name) { actions.push(`hasBranch:${name}`); return name === "bot/issue-40"; },
    async listBranchFiles(head) { actions.push(`listBranchFiles:${head}`); return [".factory/issue-40.md"]; },
    async putFile(head, file) { actions.push(`putFile:${file.path}`); },
  };
}

function memoryTerrarium(ok = true): TerrariumPort {
  return {
    async spawn(_task, taskProof) { return { runId: "r1", taskFingerprint: "fp1", nonce: "n1", taskProof }; },
    async wait() { return { runId: "r1", taskFingerprint: "fp1", nonce: "n1", ok, taskProof: "test -f package.json", taskContractStatus: ok ? "proven" : "unproven" }; },
  };
}

test("AGENTS_MODEL defaults to grok-4.6 and is overridable", () => {
  assert.equal(DEFAULT_AGENTS_MODEL, "grok-4.6");
  assert.equal(resolveAgentsModel({}), "grok-4.6");
  assert.equal(resolveAgentsModel({ AGENTS_MODEL: "kimi-k2.7" }), "kimi-k2.7");
});

test("a titled bug opens a draft without a human comment", () => {
  const classified = classifyIssue({ title: "bug: x", body: "repro", author: "o" });
  assert.equal(classified.draft, true);
  assert.equal(shouldOpenDraft(classified), true);
  const text = formatLoopBoard({ issueNumber: 52, classification: classified, modelId: "grok-4.6", stage: "labeled" });
  assert.match(text, /stage: labeled/);
  assert.match(text, /issues\/52/);
  assert.doesNotMatch(text, /a human opts this in/);
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

test("an auto error report opens a ready PR without triage:draft", () => {
  const classified = classifyIssue({
    title: "bug: The image data you provided does not represent a valid image.",
    body: "## Auto error report\n\nfingerprint: `e8a37db7f3311f4b`\norigin: client",
    author: "acoyfellow",
  });
  assert.equal(classified.draft, true);
  assert.equal(shouldOpenDraft(classified), true);
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

test("usableIssueLabels drops unknown names without a repo list", () => {
  assert.deepEqual(usableIssueLabels(["bug", "triage:draft", "not-a-label"]), ["bug", "triage:draft"]);
});

test("an opted-in draft does not open a ready PR when putFile is missing and the head is a seed", async () => {
  const github = memoryGithub();
  github.hasBranch = async () => true;
  github.listBranchFiles = async () => [".factory/issue-40.md"];
  github.putFile = undefined;
  const steps = await runTriage(
    { number: 40, title: "bug: desk href", body: "triage:draft\nrepro", author: "owner" },
    { github, terrarium: memoryTerrarium(true), model: { modelId: "grok-4.6" } },
  );
  assert.ok(steps.some((s) => s.step === "stop" && String(s.reason).includes("product files missing")));
  assert.ok(!github.actions.some((action) => action.startsWith("pr:")));
});

test("an opted-in draft never converts a factory receipt into a ready PR", async () => {
  const github = memoryGithub();
  github.hasBranch = async () => true;
  github.listBranchFiles = async () => [".factory/issue-40.md", "src/factory/issue-40.md"];
  const steps = await runTriage(
    { number: 40, title: "bug: desk href", body: "triage:draft\nrepro", author: "owner" },
    { github, terrarium: memoryTerrarium(true), model: { modelId: "grok-4.6" } },
  );
  assert.ok(steps.some((s) => s.step === "stop" && String(s.reason).includes("product files missing")));
  assert.ok(!github.actions.some((action) => action.startsWith("putFile:")));
  assert.ok(!github.actions.some((action) => action.startsWith("pr:")));
});

test("an opted-in draft opens a ready PR when the head already has a product file", async () => {
  const github = memoryGithub();
  github.hasBranch = async () => true;
  github.listBranchFiles = async () => ["src/desk-board.ts"];
  const steps = await runTriage(
    { number: 40, title: "bug: desk href", body: "triage:draft\nrepro", author: "owner" },
    { github, terrarium: memoryTerrarium(true), model: { modelId: "grok-4.6" } },
  );
  assert.ok(!steps.some((s) => s.step === "dig"));
  assert.ok(steps.some((s) => s.step === "pr" && s.number === 7));
  assert.ok(github.actions.some((action) => action.startsWith("pr:")));
});

test("auditPull does not recommend merge when the only files are factory receipts", () => {
  const stamp = auditPull(
    {
      title: "fix: terminal",
      body: "Closes #158",
      author: "acoyfellow",
      draft: false,
      headSha: "abc",
      files: [".factory/issue-158.md", "src/factory/issue-158.md"],
      behindMain: 0,
    },
    "d",
  );
  assert.equal(stamp.recommendation, "needs-human");
  assert.ok(stamp.findings.some((finding) => finding.includes("product files missing")));
});

test("auditPull treats empty files and unknown behindMain as unknown, not clean", () => {
  const empty = auditPull(
    { title: "feat", body: "ok", author: "m", draft: false, headSha: "abc", files: [], behindMain: 0 },
    "d",
  );
  assert.ok(empty.findings.some((finding) => finding.includes("files empty")));
  const unknownBehind = auditPull(
    { title: "feat", body: "ok", author: "m", draft: false, headSha: "abc", files: ["src/a.ts"], behindMain: -1 },
    "d",
  );
  assert.ok(unknownBehind.findings.some((finding) => finding.includes("behindMain unknown")));
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

test("a second identical loop board is not posted", async () => {
  const github = memoryGithub();
  const input = { number: 64, title: "bug: Invalid URL string.", body: "triage:draft", author: "owner" };
  const ports = { github, terrarium: memoryTerrarium(), model: { modelId: "grok-4.6" } };
  const first = await runTriage(input, ports);
  const second = await runTriage(input, ports);
  assert.ok(first.some((s) => s.step === "comment"));
  assert.ok(second.some((s) => s.step === "stop" && s.reason === "board already posted"));
  assert.equal(github.comments.length, 1);
});

test("first-open triage skips the comment list", async () => {
  const actions: string[] = [];
  const github = {
    ...memoryGithub(),
    async listComments() { actions.push("listComments"); return []; },
    async comment() { actions.push("comment"); },
    async labelIssue() { actions.push("label"); },
  };
  await runTriage(
    { number: 81, title: "perf: first-open triage lists every comment before the loop board", body: "receipt", author: "owner", commentsCount: 0 },
    { github, terrarium: memoryTerrarium(), model: { modelId: "grok-4.6" } },
  );
  assert.deepEqual(actions, ["label", "comment"]);
});

test("perf titles classify as draftable bugs", () => {
  const classified = classifyIssue({
    title: "perf: first-open triage lists every comment before the loop board",
    body: "triage:draft\nGET /comments is empty on first open",
    author: "owner",
  });
  assert.equal(classified.kind, "bug");
  assert.equal(classified.draft, true);
  assert.equal(formatReadyPrTitle({
    title: "perf: first-open triage lists every comment before the loop board",
    body: "",
    author: "owner",
  }), "fix: first-open triage lists every comment before the loop board");
});

test("receipt correlation is fail-closed", () => {
  assert.equal(
    verifyTerrariumReceipt(
      { runId: "r1", taskFingerprint: "fp1", nonce: "n1", taskProof: "test -f package.json" },
      { runId: "r1", taskFingerprint: "fp1", nonce: "other", ok: true, taskProof: "test -f package.json" },
    ),
    false,
  );
});

test("a terrarium receipt without taskProof is unproven", () => {
  assert.throws(() => requireTaskProof(""));
  assert.equal(
    verifyTerrariumReceipt(
      { runId: "r1", taskFingerprint: "fp1", nonce: "n1" },
      { runId: "r1", taskFingerprint: "fp1", nonce: "n1", ok: true, taskContractStatus: "proven" },
    ),
    false,
  );
});
