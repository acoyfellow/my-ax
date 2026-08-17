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
      async openDraftPr() { return { number: 1 }; },
      async mergePr() { throw new Error("forbidden GitHub action: merge"); },
      async approvePr() { throw new Error("forbidden GitHub action: approve"); },
    },
    terrarium: {
      async spawn() { return { runId: "r1", taskFingerprint: "fp1", nonce: "n1" }; },
      async wait() {
        return {
          runId: "r1",
          taskFingerprint: "fp1",
          nonce: "n1",
          ok,
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
