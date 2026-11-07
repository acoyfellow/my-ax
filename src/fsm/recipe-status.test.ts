import assert from "node:assert/strict";
import { test } from "node:test";
import { SavedRecipeError, SavedRecipeService } from "../saved-recipes";
import { initialRecipeStatus, nextRecipeStatus } from "./recipe-status";
import { sqliteD1 } from "./sqlite-d1";

const SCHEMA = `CREATE TABLE saved_recipes (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL,
  input_schema_json TEXT NOT NULL, code TEXT NOT NULL, capabilities_json TEXT NOT NULL, source_run_id TEXT, status TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`;

function serviceWith(status: string) {
  const db = sqliteD1(SCHEMA);
  db.raw.prepare("INSERT INTO saved_recipes VALUES ('r1', 'owner@example.com', 'Tool', 'A tool for tests.', '{\"type\":\"object\",\"properties\":{}}', 'return 1;', '[\"workspace.read\"]', NULL, ?, 'now', 'now')").run(status);
  const service = new SavedRecipeService({ DB: db } as never, "owner@example.com");
  return { service, status: () => (db.raw.prepare("SELECT status FROM saved_recipes").get() as { status: string }).status };
}

test("a plain PATCH cannot switch on a recipe that is waiting for review", async () => {
  const { service, status } = serviceWith("pending");
  await assert.rejects(service.update("r1", { status: "enabled" }), /must be approved/);
  assert.equal(status(), "pending");
});

test("the approval step enables a pending recipe", async () => {
  const { service, status } = serviceWith("pending");
  await service.transition("r1", "approved");
  assert.equal(status(), "enabled");
});

test("a disabled recipe can be switched back on", async () => {
  const { service, status } = serviceWith("disabled");
  await service.update("r1", { status: "enabled" });
  assert.equal(status(), "enabled");
});

test("unknown requested statuses start as pending", () => {
  assert.equal(initialRecipeStatus(undefined), "pending");
  assert.equal(initialRecipeStatus("archived"), "pending");
  assert.equal(nextRecipeStatus("pending", "enabled"), null);
  assert.ok(SavedRecipeError);
});
