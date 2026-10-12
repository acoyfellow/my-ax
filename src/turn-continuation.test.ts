import { test } from "node:test";
import assert from "node:assert/strict";
import { turnStoppedMidWork } from "./turn-continuation";

const toolSteps = (count: number) => Array.from({ length: count }, () => "tool-calls");

test("a turn that used the whole step batch while still calling tools continues", () => {
  assert.equal(turnStoppedMidWork({ status: "completed", stepFinishReasons: toolSteps(25), stepBatch: 25 }), true);
});

test("a turn whose model finished on its own does not continue", () => {
  assert.equal(turnStoppedMidWork({ status: "completed", stepFinishReasons: [...toolSteps(24), "stop"], stepBatch: 25 }), false);
});

test("a turn cut off mid tool-calls continues even when it recorded only a few steps", () => {
  assert.equal(turnStoppedMidWork({ status: "completed", stepFinishReasons: toolSteps(2), stepBatch: 25 }), true);
});

test("auto-continue is bounded, then gives up visibly", async () => {
  const { shouldAutoContinue, MAX_AUTO_CONTINUATIONS } = await import("./turn-continuation");
  const cut = { status: "completed", stepFinishReasons: toolSteps(2), stepBatch: 25 };
  assert.equal(shouldAutoContinue(cut, 0), "continue");
  assert.equal(shouldAutoContinue(cut, MAX_AUTO_CONTINUATIONS), "give-up");
  assert.equal(shouldAutoContinue({ ...cut, stepFinishReasons: ["tool-calls", "stop"] }, 0), "done");
});

test("an aborted or failed turn never continues", () => {
  assert.equal(turnStoppedMidWork({ status: "aborted", stepFinishReasons: toolSteps(25), stepBatch: 25 }), false);
  assert.equal(turnStoppedMidWork({ status: "error", stepFinishReasons: toolSteps(25), stepBatch: 25 }), false);
});
