import assert from "node:assert/strict";
import test from "node:test";
import { planVoiceDeskAction } from "./voice-command";
import type { DeskBoard } from "./desk-board";

const board: DeskBoard = {
  updatedAt: "2026-11-11T00:00:00.000Z",
  cards: [
    { id: "a", title: "Ship it", body: "", href: null, decisionHref: null, status: "pending", updatedAt: "" },
    { id: "b", title: "Done", body: "", href: null, decisionHref: null, status: "approved", updatedAt: "" },
  ],
};

test("a voice desk action never runs without a spoken confirm", () => {
  assert.deepEqual(planVoiceDeskAction(board, { kind: "approve", card: 1 }, false), { ok: false, code: "NOT_CONFIRMED", message: "say confirm to run this command" });
  assert.equal(planVoiceDeskAction(board, { kind: "dismiss", card: 1 }, false).ok, false);
});

test("card numbers are 1-based desk positions and must exist", () => {
  assert.deepEqual(planVoiceDeskAction(board, { kind: "approve", card: 1 }, true), { ok: true, cardId: "a", title: "Ship it", change: { status: "approved" } });
  assert.equal(planVoiceDeskAction(board, { kind: "approve", card: 3 }, true).ok, false);
  assert.equal(planVoiceDeskAction(board, { kind: "approve", card: 0 }, true).ok, false);
});

test("only pending cards can be approved; any card can be dismissed", () => {
  const approved = planVoiceDeskAction(board, { kind: "approve", card: 2 }, true);
  assert.equal(approved.ok, false);
  if (!approved.ok) assert.equal(approved.code, "NOT_PENDING");
  assert.deepEqual(planVoiceDeskAction(board, { kind: "dismiss", card: 2 }, true), { ok: true, cardId: "b", title: "Done", change: { remove: true } });
});
