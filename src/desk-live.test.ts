import assert from "node:assert/strict";
import test from "node:test";
import { emptyDeskBoard } from "./desk-board";
import { DESK_BOARD_FRAME, deskBoardFrame, parseDeskBoardFrame } from "./desk-live";

test("desk board frame round-trips an empty board", () => {
  const board = emptyDeskBoard("t-clear");
  const parsed = parseDeskBoardFrame(JSON.parse(deskBoardFrame(board)));
  assert.equal(parsed?.updatedAt, "t-clear");
  assert.deepEqual(parsed?.cards, []);
});

test("desk board frame ignores other socket types", () => {
  assert.equal(parseDeskBoardFrame({ type: "page_call", board: emptyDeskBoard() }), null);
  assert.equal(parseDeskBoardFrame({ type: DESK_BOARD_FRAME, extra: true }), null);
});
