import assert from "node:assert/strict";
import { test } from "node:test";
import { testDb } from "./test-db";

test("the shared test database has every migrated table", () => {
  const db = testDb();
  const tables = db.rows<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((row) => row.name);
  for (const table of ["sessions", "jobs", "runs", "saved_recipes", "attention_items", "domain_refusals"]) assert.ok(tables.includes(table), table);
});

test("it records writes and not reads", async () => {
  const db = testDb();
  await db.prepare("SELECT 1").bind().first();
  await db.prepare("INSERT INTO domain_refusals (day, refusal_key, count) VALUES (?, ?, ?)").bind("d", "k", 1).run();
  assert.deepEqual(db.writes, ["INSERT INTO domain_refusals"]);
});
