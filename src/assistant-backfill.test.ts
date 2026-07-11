import assert from "node:assert/strict";
import test from "node:test";
import { shouldBackfillAssistant, assistantBackfillCandidates } from "./assistant-backfill";

const mk = (over: Partial<{ id: string; role: string; text: string; reasoning: string }> = {}) => ({
  id: over.id ?? "m1", role: over.role ?? "assistant", text: over.text ?? "", reasoning: over.reasoning ?? "",
});

test("assistant message with visible text is a backfill candidate", () => {
  assert.equal(shouldBackfillAssistant(mk({ text: "Here is the plan." })), true);
});

test("assistant message with only reasoning still backfills", () => {
  assert.equal(shouldBackfillAssistant(mk({ text: "", reasoning: "thinking..." })), true);
});

test("empty assistant placeholder is skipped", () => {
  assert.equal(shouldBackfillAssistant(mk({ text: "   ", reasoning: "" })), false);
});

test("non-assistant roles are never backfilled here", () => {
  assert.equal(shouldBackfillAssistant(mk({ role: "user", text: "hi" })), false);
  assert.equal(shouldBackfillAssistant(mk({ role: "tool", text: "result" })), false);
  assert.equal(shouldBackfillAssistant(mk({ role: "system", text: "prompt" })), false);
});

test("a blank id is never backfilled (id is the idempotency key)", () => {
  assert.equal(shouldBackfillAssistant(mk({ id: "", text: "reply" })), false);
  assert.equal(shouldBackfillAssistant(mk({ id: "   ", text: "reply" })), false);
});

test("whitespace-only reasoning is not a backfill candidate", () => {
  assert.equal(shouldBackfillAssistant(mk({ text: "", reasoning: " \n\t " })), false);
});

test("invisible control/zero-width payloads are not treated as content", () => {
  // JS trim() leaves zero-width space, word joiner, BOM and NUL intact.
  assert.equal(shouldBackfillAssistant(mk({ text: "\u200B\u2060\u0000", reasoning: "" })), false);
  assert.equal(shouldBackfillAssistant(mk({ text: "\uFEFF \u200D", reasoning: "" })), false);
  // A real character mixed with invisibles is still content.
  assert.equal(shouldBackfillAssistant(mk({ text: "\u200Bhi", reasoning: "" })), true);
});

test("candidates filters to only content-bearing assistant messages", () => {
  const out = assistantBackfillCandidates([
    mk({ id: "a", text: "reply one" }),
    mk({ id: "b", text: "" }),
    mk({ id: "u", role: "user", text: "prompt" }),
    mk({ id: "c", text: "", reasoning: "reasoned" }),
  ]);
  assert.deepEqual(out.map((m) => m.id), ["a", "c"]);
});

test("invisible-only text (U+2063) is not visible content", () => {
  assert.equal(shouldBackfillAssistant(mk({ text: "\u2063", reasoning: "" })), false);
});

test("an invisible-only id is never backfilled (cannot be de-duplicated)", () => {
  assert.equal(shouldBackfillAssistant(mk({ id: "\u200B", text: "reply" })), false);
});
