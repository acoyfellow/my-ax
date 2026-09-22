import assert from "node:assert/strict";
import test from "node:test";
import { assistantTurnHasVisibleOutput, shouldReportInvisibleCompletion } from "./assistant-visible";

test("text or tools count as a visible completed turn", () => {
  assert.equal(assistantTurnHasVisibleOutput({ content: "hi", parts: [] }), true);
  assert.equal(assistantTurnHasVisibleOutput({ content: "", parts: [{ kind: "tool" }] }), true);
  assert.equal(assistantTurnHasVisibleOutput({ content: "  ", parts: [] }), false);
});

test("a done turn with no visible output is not an Auto error", () => {
  assert.equal(shouldReportInvisibleCompletion(false), false);
  assert.equal(shouldReportInvisibleCompletion(true), false);
});
