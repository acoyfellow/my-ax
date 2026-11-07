import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyDeskBoard, upsertDeskCard } from "../desk-board";
import { nextDeskCardStatus } from "./desk-card";

const card = { id: "card-1", title: "Ship it?" };

test("an approved desk card cannot be quietly reset to pending", () => {
  const approved = upsertDeskCard(upsertDeskCard(emptyDeskBoard(), card), { ...card, status: "approved" });
  assert.throws(() => upsertDeskCard(approved, { ...card, status: "pending" }), /approved cannot become pending/);
});

test("an answered card cannot flip to the other answer", () => {
  assert.throws(() => nextDeskCardStatus("rejected", "approved"), /rejected cannot become approved/);
});

test("editing an answered card's text keeps its answer", () => {
  const approved = upsertDeskCard(upsertDeskCard(emptyDeskBoard(), card), { ...card, status: "approved" });
  const edited = upsertDeskCard(approved, { id: card.id, title: "Shipped" });
  assert.equal(edited.cards[0].status, "approved");
  assert.equal(edited.cards[0].title, "Shipped");
});

test("a pending card can be answered, and a new card defaults to pending", () => {
  assert.equal(nextDeskCardStatus(undefined, undefined), "pending");
  assert.equal(nextDeskCardStatus(undefined, "bogus"), "pending");
  assert.equal(nextDeskCardStatus("pending", "rejected"), "rejected");
});
