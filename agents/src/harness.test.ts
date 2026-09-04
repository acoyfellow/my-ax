import assert from "node:assert/strict";
import test from "node:test";
import { executeAuditWorkflow, executeDigWorkflow, executeTriageWorkflow } from "./workflows";
import type { GithubPort, TerrariumPort } from "./orchestrate";

const env = { LLM_GATEWAY_URL: "https://opencode.cloudflare.dev/openai", LLM_GATEWAY_TOKEN: "test", AGENTS_MODEL: "grok-4.6" };

function ports(ok = true): { github: GithubPort; terrarium: TerrariumPort; labels: string[] } {
  const labels: string[] = [];
  return {
    labels,
    github: {
      async labelIssue(_n, next) { labels.push(...next); },
      async comment() {},
      async openReadyPr() { return { number: 1 }; },
      async listBranchFiles() { return ["src/error-issue.ts"]; },
    },
    terrarium: {
      async spawn(_task, taskProof) { return { runId: "r1", taskFingerprint: "fp1", nonce: "n1", taskProof }; },
      async wait() {
        return {
          runId: "r1",
          taskFingerprint: "fp1",
          nonce: "n1",
          ok,
          taskProof: "test -f package.json",
          taskContractStatus: ok ? "proven" : "unproven",
          visual: {
            lane: "public-web",
            kind: "visual-diff",
            engine: "vitest-visual-diff",
            pass: true,
            tiers: { A: true, B: true, C: true },
            url: "https://example.test/diff.png",
          },
        };
      },
    },
  };
}

test("an auto error issue creates its head branch and opens a ready PR", async () => {
  const created: Array<{ name: string; seed?: { path: string; message: string; content: string } }> = [];
  const p = ports();
  p.github.hasBranch = async () => false;
  p.github.createBranch = async (name, seed) => { created.push({ name, seed }); };
  p.github.listBranchFiles = async () => ["src/error-issue.ts"];
  const steps = await executeTriageWorkflow(env, {
    number: 4242,
    title: "bug: Invalid URL string.",
    body: "## Auto error report\n\nfingerprint: `deadbeefdeadbeef`\norigin: server\nmessage: Invalid URL string.",
    author: "owner",
  }, p);
  assert.equal(created.length, 1, "factory must create the missing head branch");
  assert.equal(created[0]!.name, "bot/issue-4242");
  assert.ok(created[0]!.seed, "branch must carry a seed commit or GitHub rejects the empty PR with 422");
  assert.match(created[0]!.seed!.path, /issue-4242/);
  assert.ok(created[0]!.seed!.content.length > 0, "seed commit must have content");
  assert.ok(steps.some((s) => s.step === "branch"), "a branch step must be recorded");
  assert.ok(steps.some((s) => s.step === "pr"), "a ready PR must be opened with no human step");
  assert.ok(
    !steps.some((s) => s.step === "stop" && /missing bot\/issue-4242/.test(s.reason)),
    "the blocked-missing-branch dead end must be gone",
  );
});

test("a seed-only issue delegates implementation before it opens a PR", async () => {
  const p = ports();
  let implemented = false;
  let opened = 0;
  let proof = "";
  let removedSeeds: string[] = [];
  p.github.hasBranch = async () => true;
  p.github.createBranchFrom = async () => {};
  p.github.branchSha = async () => implemented ? "submitted-sha" : "seed-sha";
  p.github.promoteBranch = async () => {};
  p.github.deleteBranch = async () => {};
  p.github.removeFiles = async (_head, input) => { removedSeeds = input.paths; return { sha: "clean-sha" }; };
  p.github.listBranchFiles = async () => implemented ? [".factory/issue-184.md", "src/ui/message.test.ts", "src/ui/message.ts"] : [".factory/issue-184.md"];
  p.github.openReadyPr = async () => { opened += 1; return { number: 184 }; };
  p.terrarium.implement = async (_input, taskProof) => {
    implemented = true;
    proof = taskProof;
    return { runId: "implementation-184", taskFingerprint: "fp-184", nonce: "nonce-184", taskProof };
  };
  p.terrarium.wait = async () => ({
    runId: "implementation-184",
    taskFingerprint: "fp-184",
    nonce: "nonce-184",
    ok: true,
    taskContractStatus: "proven",
  });
  const steps = await executeTriageWorkflow(env, {
    number: 184,
    title: "bug: leading space",
    body: "The rendered text starts with a space.",
    author: "owner",
  }, p);
  assert.equal(opened, 1);
  assert.deepEqual(removedSeeds, [".factory/issue-184.md"]);
  assert.match(proof, /\/usr\/bin\/curl -fsS https:\/\/api\.github\.com\/repos\/acoyfellow\/my-ax\/git\/ref\/heads\/factory%2Fsubmission-184-/);
  assert.match(proof, /test "\$submitted" != "\$target"/);
  assert.doesNotMatch(proof, /factory-submission-accepted/);
  assert.ok(steps.some((step) => step.step === "implementation" && step.verified));
  assert.ok(steps.some((step) => step.step === "pr" && step.number === 184));
});

test("a failed implementation never promotes its temporary branch", async () => {
  const p = ports();
  let promoted = false;
  let deleted = false;
  p.github.hasBranch = async () => true;
  p.github.createBranchFrom = async () => {};
  p.github.branchSha = async () => "seed-sha";
  p.github.promoteBranch = async () => { promoted = true; };
  p.github.deleteBranch = async () => { deleted = true; };
  p.github.listBranchFiles = async () => [".factory/issue-184.md"];
  p.terrarium.implement = async (_input, taskProof) => ({ runId: "failed-184", taskFingerprint: "fp-184", nonce: "nonce-184", taskProof });
  p.terrarium.wait = async () => ({ runId: "failed-184", taskFingerprint: "fp-184", nonce: "nonce-184", ok: false, taskContractStatus: "unproven" });
  const steps = await executeTriageWorkflow(env, {
    number: 184,
    title: "bug: leading space",
    body: "The rendered text starts with a space.",
    author: "owner",
  }, p);
  assert.equal(promoted, false);
  assert.equal(deleted, true);
  assert.ok(steps.some((step) => step.step === "stop" && step.reason === "implementation proof failed"));
});

test("harness issue→label", async () => {
  const p = ports();
  const steps = await executeTriageWorkflow(env, { title: "screenshot fails", body: "bug: could not create image", author: "owner" }, p);
  assert.ok(p.labels.includes("bug"));
  assert.ok(steps.some((s) => s.step === "label"));
});

test("harness hard-issue→terrarium-receipt", async () => {
  const p = ports(true);
  const steps = await executeDigWorkflow(env, { title: "complex drawer", body: "long UI repro", author: "owner" }, p);
  const dig = steps.find((s) => s.step === "dig");
  assert.ok(dig && dig.step === "dig" && dig.verified);
});

test("harness PR→audit-receipt", async () => {
  const p = ports();
  const receipt = await executeAuditWorkflow(
    env,
    { title: "feat", body: "", author: "maintainer", draft: false, headSha: "deadbeef", files: ["agents/src/policy.ts"], behindMain: 0 },
    { github: p.github, promptDigest: "agents/audit@test" },
  );
  assert.equal(receipt.headSha, "deadbeef");
  assert.equal(receipt.neverMerge, true);
});
