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

test("Decide rejects desk and attention self-links", () => {
  const desk = upsertDeskCard(emptyDeskBoard(), { id: "self-desk", title: "x", decisionHref: "/?action=desk" });
  assert.equal(desk.cards[0]?.decisionHref, null);
  const attention = upsertDeskCard(emptyDeskBoard(), { id: "self-attn", title: "x", decisionHref: "/?action=attention" });
  assert.equal(attention.cards[0]?.decisionHref, null);
});

test("emptyDeskBoard is a clearable single artifact", () => {
  const cleared = emptyDeskBoard("t-clear");
  assert.deepEqual(cleared.cards, []);
  assert.equal(cleared.updatedAt, "t-clear");
});

test("parseDeskBoard fails closed on junk", () => {
  assert.deepEqual(parseDeskBoard(null).cards, []);
  assert.equal(parseDeskBoard({ cards: [{ id: "ok", title: "Keep" }] }).cards[0]?.id, "ok");
});

test("desk status keeps known values and falls back to pending", () => {
  const approved = upsertDeskCard(emptyDeskBoard(), { id: "a", title: "a", status: "approved" });
  const rejected = upsertDeskCard(emptyDeskBoard(), { id: "r", title: "r", status: "rejected" });
  const unknown = upsertDeskCard(emptyDeskBoard(), { id: "u", title: "u", status: "ship-it" });
  const nonString = upsertDeskCard(emptyDeskBoard(), { id: "n", title: "n", status: 1 });
  assert.equal(approved.cards[0]?.status, "approved");
  assert.equal(rejected.cards[0]?.status, "rejected");
  assert.equal(unknown.cards[0]?.status, "pending");
  assert.equal(nonString.cards[0]?.status, "pending");
});

test("scheme-relative and overlong hrefs are rejected; github.com is kept", () => {
  const scheme = upsertDeskCard(emptyDeskBoard(), { id: "sr", title: "sr", decisionHref: "//evil.example/x" });
  assert.equal(scheme.cards[0]?.decisionHref, null);
  const overlong = upsertDeskCard(emptyDeskBoard(), { id: "long", title: "long", href: `https://github.com/${"a".repeat(2048)}` });
  assert.equal(overlong.cards[0]?.href, null);
  const github = upsertDeskCard(emptyDeskBoard(), { id: "gh", title: "gh", href: "https://github.com/acoyfellow/my-ax/issues/1" });
  assert.equal(github.cards[0]?.href, "https://github.com/acoyfellow/my-ax/issues/1");
  const www = upsertDeskCard(emptyDeskBoard(), { id: "www", title: "www", href: "https://www.github.com/acoyfellow/my-ax/issues/1" });
  assert.equal(www.cards[0]?.href, "https://www.github.com/acoyfellow/my-ax/issues/1");
});
