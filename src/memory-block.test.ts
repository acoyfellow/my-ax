import assert from "node:assert/strict";
import test from "node:test";
import { MEMORY_BLOCK_MAX_TOKENS, checkMemoryWrite, estimateMemoryTokens, isMemoryBlockLeak } from "./memory-block";

test("memory cap has real headroom over the wedged 2000-token block", () => {
  assert.ok(MEMORY_BLOCK_MAX_TOKENS >= 4000, "cap must be at least 4000");
  assert.ok(MEMORY_BLOCK_MAX_TOKENS > 2055, "cap must exceed the observed overflow size");
});

test("a write within the cap fits and gives no guidance", () => {
  const content = "x".repeat(MEMORY_BLOCK_MAX_TOKENS * 4 - 40);
  const check = checkMemoryWrite(content);
  assert.equal(check.fits, true);
  assert.ok(check.tokens <= check.maxTokens);
  assert.equal(check.guidance, "");
});

test("the exact 2055-token payload that wedged the old block now fits", () => {
  const content = "x".repeat(2055 * 4);
  const check = checkMemoryWrite(content);
  assert.equal(check.fits, true, "2055 tokens must fit under the raised cap");
});

test("an over-cap write degrades to recoverable guidance, never a throw", () => {
  const content = "x".repeat((MEMORY_BLOCK_MAX_TOKENS + 500) * 4);
  const check = checkMemoryWrite(content);
  assert.equal(check.fits, false);
  assert.ok(check.tokens > check.maxTokens);
  assert.match(check.guidance, /Replace stale lines/);
  assert.match(check.guidance, /Do not paste this block into a chat reply/);
});

test("estimator is monotonic and ~4 chars per token", () => {
  assert.equal(estimateMemoryTokens(""), 0);
  assert.equal(estimateMemoryTokens("abcd"), 1);
  assert.ok(estimateMemoryTokens("x".repeat(400)) === 100);
  assert.ok(estimateMemoryTokens("x".repeat(1000)) > estimateMemoryTokens("x".repeat(999)) - 1);
});

test("checkMemoryWrite never throws across a wide range of inputs", () => {
  for (const n of [0, 1, 100, 8000, 16000, 100000, 500000]) {
    assert.doesNotThrow(() => checkMemoryWrite("x".repeat(n)));
  }
});


const bigBlock = [
  "## Topic", "Making My AX deployable without the Mac.",
  "## Key Points", "Root cause is a credential-location problem, not a token scope.",
  "The container image is defined twice in wrangler.jsonc.",
  "## Current State", "Deploy kit built and pushed; live deploy succeeded via bootstrap.",
  "## Open Items", "Owner must choose the credential path.",
].join(" ").repeat(3);

test("a reply that IS the memory block is flagged as a leak", () => {
  assert.equal(isMemoryBlockLeak(bigBlock, bigBlock), true);
});

test("a reply that wraps the whole block in a little chat text is a leak", () => {
  assert.equal(isMemoryBlockLeak(`Here is the state:\n\n${bigBlock}`, bigBlock), true);
});

test("whitespace-only differences still count as a leak", () => {
  const reflowed = bigBlock.replace(/ /g, "\n");
  assert.equal(isMemoryBlockLeak(reflowed, bigBlock), true);
});

test("a normal short reply that merely mentions a fact is NOT a leak", () => {
  assert.equal(isMemoryBlockLeak("The container image is defined twice in wrangler.jsonc — want me to fix it?", bigBlock), false);
});

test("a genuine long reply that is not the block is NOT a leak", () => {
  const realReply = "Here is my plan: " + "I will wire Workers Builds, inject AUD/ISS at build time, and prove a machine-free deploy. ".repeat(20);
  assert.equal(isMemoryBlockLeak(realReply, bigBlock), false);
});

test("no memory block, or a tiny block, never triggers suppression", () => {
  assert.equal(isMemoryBlockLeak("anything", null), false);
  assert.equal(isMemoryBlockLeak("anything", undefined), false);
  assert.equal(isMemoryBlockLeak("short", "short"), false, "a sub-400-char block is below the leak floor");
});

test("an empty reply is never a leak", () => {
  assert.equal(isMemoryBlockLeak("", bigBlock), false);
});
