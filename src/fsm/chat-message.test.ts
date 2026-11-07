import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { canAcceptDelta, initialPhase, messagePhase, phaseOf, type ChatMessagePhase } from "./chat-message";

const chat = readFileSync(new URL("../ui/Chat.svelte", import.meta.url), "utf8");

test("every phase round-trips through its flags, and no phase is both pending and streaming", () => {
  for (const phase of ["optimistic", "streaming", "settled"] as ChatMessagePhase[]) {
    const flags = messagePhase(phase);
    assert.equal(phaseOf(flags), phase);
    assert.equal(flags.pending && flags.streaming, false);
  }
});

test("a confirmed Pi message follows the server's streaming flag instead of a hard-coded one", () => {
  assert.equal(initialPhase("assistant", false), "settled");
  assert.equal(initialPhase("user", true), "streaming");
  assert.equal(initialPhase("assistant"), "streaming");
  assert.equal(initialPhase("user"), "settled");
});

test("an optimistic message never takes stream deltas", () => {
  assert.equal(canAcceptDelta(messagePhase("optimistic")), false);
  assert.equal(canAcceptDelta(messagePhase("settled")), true);
});

test("Chat.svelte sets message flags only through messagePhase", () => {
  assert.doesNotMatch(chat, /\b(streaming|pending):\s*(true|false)\b/);
  assert.match(chat, /\.\.\.messagePhase\("optimistic"\)/);
});
