import test from "node:test";
import assert from "node:assert/strict";
import { buildPrompts, buildReceipt, slugify, verifyReceiptText } from "./loop-disagree.mjs";

test("buildPrompts creates distinct evidence roles", () => {
  const prompts = buildPrompts("LOOP.md");
  assert.match(prompts.builder, /strongest evidence-backed case/);
  assert.match(prompts.skeptic, /failure modes/);
  assert.match(prompts.historian, /prior artifacts/);
  assert.notEqual(prompts.builder, prompts.skeptic);
});

test("receipt verifier requires all three attributable role runs", () => {
  const receipt = buildReceipt({
    target: "LOOP.md",
    runs: { builder: "ter_builder", skeptic: "ter_skeptic", historian: "ter_historian" },
    claims: "- claim — evidence: run_id; plan delta: narrow scope",
    synthesis: "Use evidence-backed deltas only.",
    decision: "pass",
    status: "pass",
  });
  assert.equal(verifyReceiptText(receipt).ok, true);
  const missing = receipt.replace("- skeptic: ter_skeptic", "- skeptic: ");
  assert.deepEqual(verifyReceiptText(missing).failures, ["missing attributable skeptic run id"]);
});

test("receipt verifier forbids voting language", () => {
  const receipt = buildReceipt({
    target: "LOOP.md",
    runs: { builder: "ter_builder", skeptic: "ter_skeptic", historian: "ter_historian" },
    claims: "- claim — evidence: run_id; plan delta: narrow scope",
    synthesis: "The majority vote says to continue.",
    decision: "pass",
    status: "pass",
  });
  const result = verifyReceiptText(receipt);
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.includes("forbidden voting language")));
});

test("slugify keeps receipt names shell-friendly", () => {
  assert.equal(slugify("My AX LOOP.md!!"), "my-ax-loop.md");
});
