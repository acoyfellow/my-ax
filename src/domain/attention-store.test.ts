import assert from "node:assert/strict";
import { test } from "node:test";
import { dismissAllAttention, dismissAttentionItem, markAttentionItemsSeen, raiseAttentionItem } from "./Attention/Attention.store";

function fakeDb(selectIds: string[] = []) {
  const sql: string[] = [];
  const db = {
    prepare: (text: string) => ({
      bind: () => ({
        run: async () => {
          sql.push(text.trim().split(/\s+/).slice(0, 3).join(" "));
          return { meta: { changes: 2 } };
        },
        all: async <T>() => ({ results: selectIds.map((id) => ({ id })) as T[] }),
      }),
    }),
  };
  return { db, sql };
}

test("marking named items seen issues one guarded update", async () => {
  const { db, sql } = fakeDb();
  assert.equal(await markAttentionItemsSeen(db, "o@x", { ids: ["a", "b"] }), 2);
  assert.deepEqual(sql, ["UPDATE attention_items SET"]);
});

test("marking no named items writes nothing", async () => {
  const { db, sql } = fakeDb();
  assert.equal(await markAttentionItemsSeen(db, "o@x", { ids: [] }), 0);
  assert.deepEqual(sql, []);
});

test("marking all unseen items asks Domain for each unseen id, then updates", async () => {
  const { db, sql } = fakeDb(["a", "b", "c"]);
  assert.equal(await markAttentionItemsSeen(db, "o@x"), 2);
  assert.deepEqual(sql, ["UPDATE attention_items SET"]);
});

test("raising an item inserts it and trims the owner's list", async () => {
  const { db, sql } = fakeDb();
  await raiseAttentionItem(db, { id: "a", owner: "o@x", sessionId: null, kind: "k", title: "t", body: "b", href: "/", dedupeKey: null, notificationTag: null });
  assert.deepEqual(sql, ["INSERT INTO attention_items(id,", "DELETE FROM attention_items"]);
});

test("dismissing one or all items goes through Domain", async () => {
  const { db, sql } = fakeDb(["a", "b"]);
  await dismissAttentionItem(db, "o@x", "a");
  assert.equal(await dismissAllAttention(db, "o@x"), 2);
  assert.deepEqual(sql, ["DELETE FROM attention_items", "DELETE FROM attention_items"]);
});
