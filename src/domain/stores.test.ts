import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainRejected } from "./decide";
import { ensureComputer, recordComputerSnapshot, removeComputer, retitleComputer } from "./Computer/Computer.store";
import { receiveEmailRecord } from "./records";
import { createWidgetRecord, deleteWidgetRecord, setWidgetSourceHash, setWidgetTitle } from "./Widget/Widget.store";
import { testDb } from "./test-db";

const OWNER = "o@x";
const computerKey = { owner: OWNER, computerId: "desk" };

async function withWidget() {
  const db = testDb();
  await createWidgetRecord(db, { id: "w1", owner: OWNER, sessionId: "s", kind: "svelte-widget", title: "Clock", storageKey: "k", sourceHash: "h1", createdAt: "t" });
  db.writes.length = 0;
  return db;
}

function widget(db: ReturnType<typeof testDb>) {
  return db.rows<{ title: string; source_hash: string }>("SELECT title, source_hash FROM artifacts WHERE id = 'w1'")[0] ?? null;
}

async function withComputer() {
  const db = testDb();
  await ensureComputer(db, computerKey, "Desk");
  db.writes.length = 0;
  return db;
}

function computers(db: ReturnType<typeof testDb>) {
  return db.rows<{ title: string }>("SELECT title FROM computers").map((row) => row.title);
}

function snapshot(db: ReturnType<typeof testDb>) {
  return db.rows<{ backup_id: string; snapshot_version: number }>("SELECT backup_id, snapshot_version FROM computer_snapshots")[0] ?? null;
}

test("a widget is inserted only when Domain accepts CreateWidget", async () => {
  const db = testDb();
  await createWidgetRecord(db, { id: "w1", owner: OWNER, sessionId: "s", kind: "svelte-widget", title: "Clock", storageKey: "k", sourceHash: "h", createdAt: "t" });
  assert.deepEqual(db.writes, ["INSERT INTO artifacts"]);
  assert.equal(widget(db)?.title, "Clock");
});

test("renaming or re-sourcing a missing widget writes nothing", async () => {
  const db = testDb();
  assert.equal(await setWidgetTitle(db, OWNER, "w1", "New", "t"), false);
  await setWidgetSourceHash(db, OWNER, "w1", "h2", "t");
  assert.deepEqual(db.writes, []);
});

test("deleting a missing widget is refused by Domain", async () => {
  const db = testDb();
  await assert.rejects(deleteWidgetRecord(db, OWNER, "w1"), (error: unknown) => error instanceof DomainRejected && error.rejection._tag === "WidgetNotFound");
  assert.deepEqual(db.writes, []);
});

test("an existing widget is renamed, re-sourced and deleted", async () => {
  const db = await withWidget();
  assert.equal(await setWidgetTitle(db, OWNER, "w1", "New", "t"), true);
  await setWidgetSourceHash(db, OWNER, "w1", "h2", "t");
  assert.deepEqual({ ...widget(db) }, { title: "New", source_hash: "h2" });
  await deleteWidgetRecord(db, OWNER, "w1");
  assert.deepEqual(db.writes, ["UPDATE artifacts SET", "UPDATE artifacts SET", "DELETE FROM artifacts"]);
  assert.equal(widget(db), null);
});

test("a new computer is created, an existing one is touched", async () => {
  const db = testDb();
  await ensureComputer(db, computerKey, "Desk");
  assert.deepEqual(db.writes, ["INSERT INTO computers"]);
  db.writes.length = 0;
  await ensureComputer(db, computerKey, "Desk");
  assert.deepEqual(db.writes, ["UPDATE computers SET"]);
  assert.deepEqual(computers(db), ["Desk"]);
});

test("a missing computer cannot be renamed or removed", async () => {
  const db = testDb();
  assert.equal(await retitleComputer(db, computerKey, "New"), false);
  await assert.rejects(removeComputer(db, computerKey), (error: unknown) => error instanceof DomainRejected && error.rejection._tag === "ComputerNotFound");
  assert.deepEqual(db.writes, []);
});

test("removing a computer deletes its snapshot and record", async () => {
  const db = await withComputer();
  await recordComputerSnapshot(db, computerKey, "b", "/h");
  db.writes.length = 0;
  await removeComputer(db, computerKey);
  assert.deepEqual(db.writes, ["DELETE FROM computer_snapshots", "DELETE FROM computers"]);
  assert.deepEqual(computers(db), []);
  assert.equal(snapshot(db), null);
});

test("a computer snapshot is created first and versioned after", async () => {
  const db = await withComputer();
  await recordComputerSnapshot(db, computerKey, "b0", "/h");
  const first = snapshot(db)?.snapshot_version ?? 0;
  await recordComputerSnapshot(db, computerKey, "b1", "/h");
  assert.deepEqual(db.writes, ["INSERT INTO computer_snapshots(owner_email,", "INSERT INTO computer_snapshots(owner_email,"]);
  assert.equal(snapshot(db)?.backup_id, "b1");
  assert.ok((snapshot(db)?.snapshot_version ?? 0) > first);
});

test("an inbound email is recorded through Domain", async () => {
  const db = testDb();
  await receiveEmailRecord(db, { id: "e1", owner: OWNER, from: "a@b", to: OWNER, subject: "Hi", body: "Hello" });
  assert.deepEqual(db.writes, ["INSERT INTO emails"]);
  assert.equal(db.rows<{ subject: string }>("SELECT subject FROM emails")[0]?.subject, "Hi");
});
