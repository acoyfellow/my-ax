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

test("a short turn does not continue", () => {
  assert.equal(turnStoppedMidWork({ status: "completed", stepFinishReasons: toolSteps(3), stepBatch: 25 }), false);
});

test("an aborted or failed turn never continues", () => {
  assert.equal(turnStoppedMidWork({ status: "aborted", stepFinishReasons: toolSteps(25), stepBatch: 25 }), false);
  assert.equal(turnStoppedMidWork({ status: "error", stepFinishReasons: toolSteps(25), stepBatch: 25 }), false);
});
