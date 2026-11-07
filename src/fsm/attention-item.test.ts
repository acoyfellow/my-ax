import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAttentionListFilter } from "../routes/attention";
import { attentionState, markAttentionSeen } from "./attention-item";
import { sqliteD1 } from "./sqlite-d1";

const SCHEMA = "CREATE TABLE attention_items (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, session_id TEXT, kind TEXT, seen_at TEXT)";

function db() {
  const database = sqliteD1(SCHEMA);
  const insert = database.raw.prepare("INSERT INTO attention_items VALUES (?, ?, ?, ?, ?)");
  insert.run("a", "owner@example.com", "s1", "job.complete", null);
  insert.run("b", "owner@example.com", "s2", "session.update", null);
  insert.run("c", "owner@example.com", "s1", "job.complete", "2000-01-01 00:00:00");
  insert.run("d", "other@example.com", "s1", "job.complete", null);
  const seenAt = (id: string) => (database.raw.prepare("SELECT seen_at FROM attention_items WHERE id = ?").get(id) as { seen_at: string | null }).seen_at;
  return { database, seenAt };
}

test("marking an item seen keeps the first time it was seen", async () => {
  const { database, seenAt } = db();
  assert.equal(await markAttentionSeen(database, "owner@example.com", { ids: ["c"] }), 0);
  assert.equal(seenAt("c"), "2000-01-01 00:00:00");
});

test("an owner cannot mark another owner's item seen by id", async () => {
  const { database, seenAt } = db();
  assert.equal(await markAttentionSeen(database, "owner@example.com", { ids: ["d"] }), 0);
  assert.equal(seenAt("d"), null);
});

test("a filtered mark-all only touches the owner's matching unseen items", async () => {
  const { database, seenAt } = db();
  const { filterSql, bindValues } = buildAttentionListFilter("owner@example.com", { kind: "job.complete", sessionId: "s1" });
  assert.equal(await markAttentionSeen(database, "owner@example.com", { filterSql, filterBinds: bindValues.slice(1) }), 1);
  assert.equal(attentionState({ seen_at: seenAt("a") }), "seen");
  assert.equal(attentionState({ seen_at: seenAt("b") }), "unseen");
  assert.equal(seenAt("d"), null);
});

test("an explicit empty id list marks nothing", async () => {
  const { database } = db();
  assert.equal(await markAttentionSeen(database, "owner@example.com", { ids: [] }), 0);
});
