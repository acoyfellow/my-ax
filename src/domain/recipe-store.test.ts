import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainRejected } from "./decide";
import { deleteRecipeRecord, updateRecipeRecord } from "./Recipe/Recipe.store";
import { testDb } from "./test-db";

const OWNER = "o@x";

function withRecipe(status: string) {
  const db = testDb();
  db.exec(`INSERT INTO saved_recipes (id, owner_email, name, description, input_schema_json, code, capabilities_json, status) VALUES ('r1', '${OWNER}', 'n', 'd', '{}', 'c', '[]', '${status}')`);
  return db;
}

function row(db: ReturnType<typeof testDb>) {
  return db.rows<{ status: string; name: string }>("SELECT status, name FROM saved_recipes WHERE id = 'r1'")[0] ?? null;
}

test("a pending recipe cannot be enabled directly, and no SQL runs", async () => {
  const db = withRecipe("pending");
  await assert.rejects(updateRecipeRecord(db, { id: "r1", owner_email: OWNER, status: "pending" }, "enabled", [{ column: "status", value: "enabled" }], "t"), DomainRejected);
  assert.deepEqual(db.writes, []);
  assert.equal(row(db)?.status, "pending");
});

test("approving a pending recipe runs the guarded update", async () => {
  const db = withRecipe("pending");
  await updateRecipeRecord(db, { id: "r1", owner_email: OWNER, status: "pending" }, "approved", [{ column: "status", value: "enabled" }], "t");
  assert.deepEqual(db.writes, ["UPDATE saved_recipes SET"]);
  assert.equal(row(db)?.status, "enabled");
});

test("editing fields of an existing recipe is allowed", async () => {
  const db = withRecipe("disabled");
  await updateRecipeRecord(db, { id: "r1", owner_email: OWNER, status: "disabled" }, undefined, [{ column: "name", value: "renamed" }], "t");
  assert.deepEqual(db.writes, ["UPDATE saved_recipes SET"]);
  assert.equal(row(db)?.name, "renamed");
});

test("deleting a recipe decides before the delete", async () => {
  const db = withRecipe("enabled");
  await deleteRecipeRecord(db, { id: "r1", owner_email: OWNER, status: "enabled" }, "r1", OWNER);
  assert.deepEqual(db.writes, ["DELETE FROM saved_recipes"]);
  assert.equal(row(db), null);
});
