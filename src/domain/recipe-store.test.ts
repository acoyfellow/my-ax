import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainRejected } from "./decide";
import { deleteRecipeRecord, updateRecipeRecord } from "./Recipe/Recipe.store";

function fakeDb() {
  const writes: string[] = [];
  const db = { prepare: (sql: string) => ({ bind: () => ({ run: async () => { writes.push(sql.split(" ")[0]); return { meta: { changes: 1 } }; } }) }) };
  return { db, writes };
}

test("a pending recipe cannot be enabled directly, and no SQL runs", async () => {
  const { db, writes } = fakeDb();
  await assert.rejects(updateRecipeRecord(db, { id: "r1", owner_email: "o@x", status: "pending" }, "enabled", [{ column: "status", value: "enabled" }], "t"), DomainRejected);
  assert.deepEqual(writes, []);
});

test("approving a pending recipe runs the guarded update", async () => {
  const { db, writes } = fakeDb();
  await updateRecipeRecord(db, { id: "r1", owner_email: "o@x", status: "pending" }, "approved", [{ column: "status", value: "enabled" }], "t");
  assert.deepEqual(writes, ["UPDATE"]);
});

test("editing fields of an existing recipe is allowed", async () => {
  const { db, writes } = fakeDb();
  await updateRecipeRecord(db, { id: "r1", owner_email: "o@x", status: "disabled" }, undefined, [{ column: "name", value: "n" }], "t");
  assert.deepEqual(writes, ["UPDATE"]);
});

test("deleting a recipe decides before the delete", async () => {
  const { db, writes } = fakeDb();
  await deleteRecipeRecord(db, { id: "r1", owner_email: "o@x", status: "enabled" }, "r1", "o@x");
  assert.deepEqual(writes, ["DELETE"]);
});
