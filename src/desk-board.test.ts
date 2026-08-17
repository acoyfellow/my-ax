import assert from "node:assert/strict";
import test from "node:test";
import { emptyDeskBoard, parseDeskBoard, upsertDeskCard } from "./desk-board";

const gitlabHost = ["gitlab", ["cf", "data"].join(""), "org"].join(".");
const gitlabMr = ["https://", gitlabHost, "/group/project/-/merge_requests/1"].join("");

test("upsert replaces a card by id and keeps newest first", () => {
  const first = upsertDeskCard(emptyDeskBoard("t0"), { id: "mr-1", title: "old", href: gitlabMr }, "t1");
  const second = upsertDeskCard(first, { id: "mr-1", title: "new draft", body: "approve?" }, "t2");
  assert.equal(second.cards.length, 1);
  assert.equal(second.cards[0]?.title, "new draft");
  assert.equal(second.cards[0]?.href, gitlabMr);
  assert.equal(second.updatedAt, "t2");
});

test("javascript and unknown hosts are stripped from hrefs", () => {
  const board = upsertDeskCard(emptyDeskBoard(), { id: "x", title: "x", href: "javascript:alert(1)" });
  assert.equal(board.cards[0]?.href, null);
  assert.throws(() => upsertDeskCard(emptyDeskBoard(), { id: "", title: "x" }));
});

test("Open source rejects same-origin paths; Decide keeps them", () => {
  const board = upsertDeskCard(emptyDeskBoard(), {
    id: "desk-href-proof",
    title: "proof",
    href: "/?action=desk",
    decisionHref: "/api/decisions/run-decision-test",
  });
  assert.equal(board.cards[0]?.href, null);
  assert.equal(board.cards[0]?.decisionHref, "/api/decisions/run-decision-test");
});

test("parseDeskBoard fails closed on junk", () => {
  assert.deepEqual(parseDeskBoard(null).cards, []);
  assert.equal(parseDeskBoard({ cards: [{ id: "ok", title: "Keep" }] }).cards[0]?.id, "ok");
});
