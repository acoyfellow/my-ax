import assert from "node:assert/strict";
import test from "node:test";
import { planReorder, planKeyboardStep, splitPinned, reorderAnnouncement } from "./pinned-reorder";

test("planReorder: move to top yields beforeId = old first", () => {
  const r = planReorder(["a", "b", "c"], "c", 0);
  assert.deepEqual(r?.order, ["c", "a", "b"]);
  assert.equal(r?.beforeId, "a");
});

test("planReorder: move to middle sits before the row now after it", () => {
  const r = planReorder(["a", "b", "c"], "c", 1);
  assert.deepEqual(r?.order, ["a", "c", "b"]);
  assert.equal(r?.beforeId, "b");
});

test("planReorder: move to bottom yields beforeId = null", () => {
  const r = planReorder(["a", "b", "c"], "a", 2);
  assert.deepEqual(r?.order, ["b", "c", "a"]);
  assert.equal(r?.beforeId, null);
});

test("planReorder: clamps out-of-range index and handles unknown id", () => {
  const past = planReorder(["a", "b"], "a", 99);
  assert.deepEqual(past?.order, ["b", "a"]);
  assert.equal(past?.beforeId, null);
  assert.equal(planReorder(["a", "b"], "zzz", 0), null);
});

test("planKeyboardStep: up/down move one slot and expose beforeId", () => {
  const up = planKeyboardStep(["a", "b", "c"], "c", "up");
  assert.deepEqual(up?.order, ["a", "c", "b"]);
  assert.equal(up?.beforeId, "b");
  assert.equal(up?.toIndex, 1);

  const down = planKeyboardStep(["a", "b", "c"], "a", "down");
  assert.deepEqual(down?.order, ["b", "a", "c"]);
  assert.equal(down?.beforeId, "c");
  assert.equal(down?.toIndex, 1);
});

test("planKeyboardStep: no-op at the edges", () => {
  assert.equal(planKeyboardStep(["a", "b", "c"], "a", "up"), null, "top row cannot move up");
  assert.equal(planKeyboardStep(["a", "b", "c"], "c", "down"), null, "bottom row cannot move down");
  assert.equal(planKeyboardStep(["a"], "a", "up"), null);
});

test("splitPinned separates and rank-sorts the pinned group", () => {
  const rows = [
    { id: "u1", pinned: 0, pin_rank: null },
    { id: "p2", pinned: 1, pin_rank: "M" },
    { id: "u2", pinned: 0, pin_rank: null },
    { id: "p1", pinned: 1, pin_rank: "A" },
  ];
  const { pinned, unpinned } = splitPinned(rows);
  assert.deepEqual(pinned.map((r) => r.id), ["p1", "p2"], "pinned sorted by rank ASC");
  assert.deepEqual(unpinned.map((r) => r.id), ["u1", "u2"], "unpinned keeps input order");
});

test("splitPinned: no pinned rows -> empty pinned group", () => {
  const { pinned, unpinned } = splitPinned([{ id: "a", pinned: 0 }, { id: "b" }]);
  assert.equal(pinned.length, 0);
  assert.deepEqual(unpinned.map((r) => r.id), ["a", "b"]);
});

test("reorderAnnouncement is a clear 1-based position string", () => {
  assert.equal(reorderAnnouncement("Dog food", 0, 3), "Dog food, pinned 1 of 3.");
  assert.equal(reorderAnnouncement("", 2, 3), "Conversation, pinned 3 of 3.");
});
