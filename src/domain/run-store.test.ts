import assert from "node:assert/strict";
import { test } from "node:test";
import { dismissRunRecord, dismissRunRecords, guardedRunTransition, startRunRecord, transitionRunRecord } from "./Run/Run.store";
import { DomainRejected } from "./decide";
import { testDb } from "./test-db";

const OWNER = "o@x";

async function seeded(status: "open" | "running" | "completed" | "failed", id = "r1") {
  const db = testDb();
  await startRunRecord(db, { id, ownerEmail: OWNER, sessionId: null, status: status === "running" ? "running" : "open", title: "t", taskSummary: "s", boundsJson: "{}", createdAt: null });
  if (status === "completed" || status === "failed") db.exec(`UPDATE runs SET status = '${status}' WHERE id = '${id}'`);
  db.writes.length = 0;
  return db;
}

function statusOf(db: ReturnType<typeof testDb>, id = "r1") {
  return db.rows<{ status: string; dismissed_at: string | null }>("SELECT status, dismissed_at FROM runs WHERE id = ?", id)[0] ?? null;
}

test("a move Domain refuses never reaches the database", async () => {
  const db = await seeded("completed");
  const applied = await transitionRunRecord(db, "r1", OWNER, "RecordReceipt", guardedRunTransition("running", ["open"], "r1", OWNER));
  assert.equal(applied, false);
  assert.deepEqual(db.writes, []);
  assert.equal(statusOf(db)?.status, "completed");
});

test("a move Domain accepts sends the guarded update and changes the row", async () => {
  const db = await seeded("open");
  const applied = await transitionRunRecord(db, "r1", OWNER, "RecordReceipt", guardedRunTransition("running", ["open"], "r1", OWNER));
  assert.equal(applied, true);
  assert.deepEqual(db.writes, ["UPDATE runs SET"]);
  assert.equal(statusOf(db)?.status, "running");
});

test("a move on a missing run writes nothing", async () => {
  const db = testDb();
  assert.equal(await transitionRunRecord(db, "r1", OWNER, "CompleteRun", guardedRunTransition("completed", ["open", "running"], "r1", OWNER)), false);
  assert.deepEqual(db.writes, []);
});

test("another owner's run is not moved", async () => {
  const db = await seeded("open");
  assert.equal(await transitionRunRecord(db, "r1", "other@x", "RecordReceipt", guardedRunTransition("running", ["open"], "r1", "other@x")), false);
  assert.equal(statusOf(db)?.status, "open");
});

test("a new run is started once in the stage asked for", async () => {
  const db = testDb();
  await startRunRecord(db, { id: "r1", ownerEmail: OWNER, sessionId: null, status: "open", title: "t", taskSummary: "s", boundsJson: "{}", createdAt: null });
  await startRunRecord(db, { id: "r2", ownerEmail: OWNER, sessionId: "s1", status: "running", title: "t", taskSummary: "s", boundsJson: "{}", createdAt: "2026-01-01" });
  assert.deepEqual(db.writes, ["INSERT INTO runs(id,", "INSERT INTO runs"]);
  assert.equal(statusOf(db, "r1")?.status, "open");
  assert.equal(statusOf(db, "r2")?.status, "running");
});

test("dismissing reports missing runs and dismisses known ones", async () => {
  const missing = testDb();
  assert.deepEqual(await dismissRunRecord(missing, "r1", OWNER), { found: false, changed: false });
  assert.deepEqual(missing.writes, []);
  const known = await seeded("failed");
  await startRunRecord(known, { id: "r2", ownerEmail: OWNER, sessionId: null, status: "open", title: "t", taskSummary: "s", boundsJson: "{}", createdAt: null });
  known.writes.length = 0;
  assert.deepEqual(await dismissRunRecord(known, "r1", OWNER), { found: true, changed: true });
  assert.ok(statusOf(known, "r1")?.dismissed_at);
  assert.equal(await dismissRunRecords(known, OWNER, null), 1);
  assert.deepEqual(known.writes, ["UPDATE runs SET", "UPDATE runs SET"]);
  assert.ok(statusOf(known, "r2")?.dismissed_at);
});

test("the guarded update keeps the SQL from-status guard", () => {
  const guarded = guardedRunTransition("completed", ["open", "running"], "r1", OWNER);
  assert.match(guarded.sql, /AND status IN \(\?, \?\)$/);
  assert.deepEqual(guarded.binds, ["completed", "r1", OWNER, "open", "running"]);
  assert.equal(DomainRejected.name, "DomainRejected");
});
