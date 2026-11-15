import assert from "node:assert/strict";
import { test } from "node:test";
import { dismissAllAttention, dismissAttentionItem, markAttentionItemsSeen, raiseAttentionItem } from "./Attention/Attention.store";
import { testDb } from "./test-db";

const OWNER = "o@x";

async function withItems(ids: string[]) {
  const db = testDb();
  for (const id of ids) await raiseAttentionItem(db, { id, owner: OWNER, sessionId: null, kind: "k", title: "t", body: "b", href: "/", dedupeKey: null, notificationTag: null });
  db.writes.length = 0;
  return db;
}

function items(db: ReturnType<typeof testDb>) {
  return db.rows<{ id: string; seen_at: string | null }>("SELECT id, seen_at FROM attention_items ORDER BY id");
}

test("marking named items seen issues one guarded update", async () => {
  const db = await withItems(["a", "b", "c"]);
  assert.equal(await markAttentionItemsSeen(db, OWNER, { ids: ["a", "b"] }), 2);
  assert.deepEqual(db.writes, ["UPDATE attention_items SET"]);
  assert.deepEqual(items(db).map((row) => Boolean(row.seen_at)), [true, true, false]);
});

test("marking no named items writes nothing", async () => {
  const db = await withItems(["a"]);
  assert.equal(await markAttentionItemsSeen(db, OWNER, { ids: [] }), 0);
  assert.deepEqual(db.writes, []);
});

test("marking all unseen items asks Domain for each unseen id, then updates", async () => {
  const db = await withItems(["a", "b", "c"]);
  assert.equal(await markAttentionItemsSeen(db, OWNER), 3);
  assert.deepEqual(db.writes, ["UPDATE attention_items SET"]);
  assert.ok(items(db).every((row) => row.seen_at));
});

test("raising an item inserts it and trims the owner's list", async () => {
  const db = testDb();
  await raiseAttentionItem(db, { id: "a", owner: OWNER, sessionId: null, kind: "k", title: "t", body: "b", href: "/", dedupeKey: null, notificationTag: null });
  assert.deepEqual(db.writes, ["INSERT INTO attention_items(id,", "DELETE FROM attention_items"]);
  assert.deepEqual(items(db).map((row) => row.id), ["a"]);
});

test("dismissing one or all items goes through Domain", async () => {
  const db = await withItems(["a", "b", "c"]);
  await dismissAttentionItem(db, OWNER, "a");
  assert.equal(await dismissAllAttention(db, OWNER), 2);
  assert.deepEqual(db.writes, ["DELETE FROM attention_items", "DELETE FROM attention_items"]);
  assert.deepEqual(items(db), []);
});
