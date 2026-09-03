import assert from "node:assert/strict";
import test from "node:test";
import { DESK_REPLY_MAX_CHARS, deskStatusTone, emptyDeskBoard, markDeskCardReplied, parseDeskBoard, prepareDeskCardReply, upsertDeskCard } from "./desk-board";

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

test("legacy card data keeps a descriptive status and a decision action", () => {
  const board = parseDeskBoard({
    cards: [{
      id: "desk-href-proof",
      title: "Oracle report",
      status: "in progress",
      agent: "Oracle",
      href: "/?action=desk",
      decisionHref: "/api/decisions/run-decision-test",
    }],
  });
  const card = board.cards[0];
  assert.equal(card?.href, null);
  assert.equal(card?.status, "in progress");
  assert.equal(card?.agent, "Oracle");
  assert.equal(card?.actionHref, "/api/decisions/run-decision-test");
  assert.equal(card?.actionLabel, "Decide");
});

test("actions reject desk and attention self-links", () => {
  const desk = upsertDeskCard(emptyDeskBoard(), { id: "self-desk", title: "x", actionHref: "/?action=desk" });
  assert.equal(desk.cards[0]?.actionHref, null);
  const attention = upsertDeskCard(emptyDeskBoard(), { id: "self-attn", title: "x", actionHref: "/?action=attention" });
  assert.equal(attention.cards[0]?.actionHref, null);
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

test("descriptive statuses have useful display tones", () => {
  assert.equal(deskStatusTone("in progress"), "neutral");
  assert.equal(deskStatusTone("needs input"), "attention");
  assert.equal(deskStatusTone("blocked"), "bad");
  assert.equal(deskStatusTone("done"), "ok");
  assert.equal(upsertDeskCard(emptyDeskBoard(), { id: "state", title: "state", status: "waiting on deploy" }).cards[0]?.status, "waiting on deploy");
  assert.equal(upsertDeskCard(emptyDeskBoard(), { id: "no-state", title: "no-state", status: 1 }).cards[0]?.status, null);
});

test("scheme-relative and overlong hrefs are rejected; github.com is kept", () => {
  const scheme = upsertDeskCard(emptyDeskBoard(), { id: "sr", title: "sr", actionHref: "//evil.example/x" });
  assert.equal(scheme.cards[0]?.actionHref, null);
  const overlong = upsertDeskCard(emptyDeskBoard(), { id: "long", title: "long", href: `https://github.com/${"a".repeat(2048)}` });
  assert.equal(overlong.cards[0]?.href, null);
  const github = upsertDeskCard(emptyDeskBoard(), { id: "gh", title: "gh", href: "https://github.com/acoyfellow/my-ax/issues/1" });
  assert.equal(github.cards[0]?.href, "https://github.com/acoyfellow/my-ax/issues/1");
  const www = upsertDeskCard(emptyDeskBoard(), { id: "www", title: "www", href: "https://www.github.com/acoyfellow/my-ax/issues/1" });
  assert.equal(www.cards[0]?.href, "https://www.github.com/acoyfellow/my-ax/issues/1");
});

test("an answerable card prepares a reply for its originating conversation", () => {
  const board = upsertDeskCard(emptyDeskBoard("t0"), {
    id: "release-question",
    title: "Release needs a target",
    body: "The staging checks passed.",
    status: "needs input",
    agent: "Release agent",
    originSessionId: "session-1",
    reply: { label: "Send target", prompt: "Which environment should I deploy?", placeholder: "staging or production" },
  }, "t1");
  const prepared = prepareDeskCardReply(board, "release-question", " production ");
  assert.deepEqual(prepared, {
    cardId: "release-question",
    cardUpdatedAt: "t1",
    originSessionId: "session-1",
    clientMsgId: "desk-reply:release-question:t1",
    content: "[desk reply]\nCard: Release needs a target\nContext: The staging checks passed.\nPrompt: Which environment should I deploy?\nAnswer: production",
  });
});

test("answered cards cannot be replied to again", () => {
  const board = upsertDeskCard(emptyDeskBoard("t0"), {
    id: "question",
    title: "Need approval",
    originSessionId: "session-1",
    reply: { label: "Reply", prompt: "Proceed?" },
  }, "t1");
  const reply = prepareDeskCardReply(board, "question", "Yes");
  const answered = markDeskCardReplied(board, reply, "t2");
  assert.equal(answered.cards[0]?.status, "answered");
  assert.equal(answered.cards[0]?.reply, null);
  assert.equal(answered.cards[0]?.originSessionId, "session-1");
  assert.equal(answered.cards[0]?.updatedAt, "t2");
  assert.throws(() => prepareDeskCardReply(answered, "question", "Yes"));
});

test("invalid reply metadata and reply text fail closed", () => {
  assert.throws(() => upsertDeskCard(emptyDeskBoard(), {
    id: "missing-origin",
    title: "Question",
    reply: { label: "Reply", prompt: "What now?" },
  }));
  assert.throws(() => upsertDeskCard(emptyDeskBoard(), {
    id: "bad-reply",
    title: "Question",
    originSessionId: "session-1",
    reply: { label: "", prompt: "What now?" },
  }));
  const board = upsertDeskCard(emptyDeskBoard(), {
    id: "question",
    title: "Question",
    originSessionId: "session-1",
    reply: { label: "Reply", prompt: "What now?" },
  });
  assert.throws(() => prepareDeskCardReply(board, "question", "  "));
  assert.throws(() => prepareDeskCardReply(board, "question", "x".repeat(DESK_REPLY_MAX_CHARS + 1)));
  assert.throws(() => prepareDeskCardReply(board, "question", 1));
});
