import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { Database } from "../effect/database";
import { SESSION_SQL, sessionStatusStatement, sessionWrite, sessionWriteEffect, transitionSessionRecord } from "./Session/Session.store";
import { testDb } from "./test-db";

const OWNER = "o@x";

async function withSession(status = "active") {
  const db = testDb();
  await sessionWrite(db, SESSION_SQL.S01_OPEN, ["s1", "Main", OWNER]);
  if (status !== "active") db.exec(`UPDATE sessions SET status = '${status}' WHERE id = 's1'`);
  db.writes.length = 0;
  return db;
}

function row(db: ReturnType<typeof testDb>) {
  return db.rows<{ status: string; name: string }>("SELECT status, name FROM sessions WHERE id = 's1'")[0] ?? null;
}

const turnStuck = { command: "MarkTurnStuck" as const, ...sessionStatusStatement({ from: ["running"], to: "active", touchUpdatedAt: true }) };
const turnStarted = { command: "StartTurn" as const, ...sessionStatusStatement({ from: ["active", "error", "interrupted", "running", "archived"], to: "running", touchUpdatedAt: true }) };

test("renaming a missing session writes nothing", async () => {
  const db = testDb();
  const result = await sessionWrite(db, SESSION_SQL.S08_NAME, ["New", "s1", OWNER]);
  assert.equal(result.meta.changes, 0);
  assert.deepEqual(db.writes, []);
});

test("renaming an open session updates the row", async () => {
  const db = await withSession();
  assert.equal((await sessionWrite(db, SESSION_SQL.S08_NAME, ["New", "s1", OWNER])).meta.changes, 1);
  assert.deepEqual(db.writes, ["UPDATE sessions SET"]);
  assert.equal(row(db)?.name, "New");
});

test("deleting a missing session writes nothing, an open one is deleted", async () => {
  const missing = testDb();
  assert.equal((await sessionWrite(missing, SESSION_SQL.S02_DELETE, ["s1", OWNER])).meta.changes, 0);
  assert.deepEqual(missing.writes, []);
  const present = await withSession();
  await sessionWrite(present, SESSION_SQL.S02_DELETE, ["s1", OWNER]);
  assert.deepEqual(present.writes, ["DELETE FROM sessions"]);
  assert.equal(row(present), null);
});

test("opening a session inserts an active row", async () => {
  const db = testDb();
  await sessionWrite(db, SESSION_SQL.S01_OPEN, ["s1", "Main", OWNER]);
  assert.deepEqual(db.writes, ["INSERT INTO sessions"]);
  assert.deepEqual({ ...row(db) }, { status: "active", name: "Main" });
});

test("a stuck turn on an archived session is refused before SQL", async () => {
  const db = await withSession("archived");
  assert.equal(await transitionSessionRecord(db, { id: "s1", ownerEmail: OWNER }, "turn_stuck", turnStuck), false);
  assert.deepEqual(db.writes, []);
  assert.equal(row(db)?.status, "archived");
});

test("a started turn on an open session is applied", async () => {
  const db = await withSession();
  assert.equal(await transitionSessionRecord(db, { id: "s1", ownerEmail: OWNER }, "turn_started", turnStarted), true);
  assert.deepEqual(db.writes, ["UPDATE sessions SET"]);
  assert.equal(row(db)?.status, "running");
});

test("another owner cannot move the session", async () => {
  const db = await withSession();
  assert.equal(await transitionSessionRecord(db, { id: "s1", ownerEmail: "other@x" }, "turn_started", turnStarted), false);
  assert.equal(row(db)?.status, "active");
});

test("pinning a missing session through Effect writes nothing", async () => {
  const ran: string[] = [];
  const database = { first: () => Effect.succeed(null), all: () => Effect.succeed([]), run: (sql: string) => Effect.sync(() => void ran.push(sql)) };
  const wrote = await Effect.runPromise(Effect.provideService(sessionWriteEffect(SESSION_SQL.S15_PIN, ["s1", OWNER]), Database, database as never));
  assert.equal(wrote, false);
  assert.deepEqual(ran, []);
});
