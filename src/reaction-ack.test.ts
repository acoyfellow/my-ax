import assert from "node:assert/strict";
import test from "node:test";
import { REACTION_ACK_MAX_MS, REACTION_ACK_MIN_MS, reactionAckDelayMs, reactionForPrompt } from "./model-layers";

test("reactionAckDelayMs always lands inside 50..150ms", () => {
  assert.equal(reactionAckDelayMs(() => 0), REACTION_ACK_MIN_MS);
  assert.equal(reactionAckDelayMs(() => 0.9999), REACTION_ACK_MAX_MS);
  assert.equal(reactionAckDelayMs(() => 0.5), 100);
  for (let i = 0; i < 40; i++) {
    const ms = reactionAckDelayMs();
    assert.ok(ms >= REACTION_ACK_MIN_MS && ms <= REACTION_ACK_MAX_MS, `out of range: ${ms}`);
  }
});

test("reactionForPrompt matches prompt intent and attachments", () => {
  assert.equal(reactionForPrompt("ship this to prod").emoji, "🚀");
  assert.equal(reactionForPrompt("fix the broken overlap bug").emoji, "🔧");
  assert.equal(reactionForPrompt("make the sidebar modal responsive").emoji, "🎨");
  assert.equal(reactionForPrompt("run a benchmark and verify latency").emoji, "🧪");
  assert.equal(reactionForPrompt("search the repo for hooks").emoji, "🔍");
  assert.equal(reactionForPrompt("prune stale branches").emoji, "🧹");
  assert.equal(reactionForPrompt("explain how compaction works").emoji, "🧠");
  assert.equal(reactionForPrompt("hey").emoji, "👋");
  assert.equal(reactionForPrompt("yup").emoji, "👍");
  assert.equal(reactionForPrompt("", true).emoji, "🖼️");
  assert.equal(reactionForPrompt("something totally unusual").emoji, "👀");
});
