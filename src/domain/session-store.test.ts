import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { Database } from "../effect/database";
import { SESSION_SQL, sessionWrite, sessionWriteEffect, transitionSessionRecord } from "./Session/Session.store";

type Row = { status: string; name: string; owner_email: string } | null;

function fakeDb(row: Row) {
  const writes: string[] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: () => ({
        run: async () => {
          writes.push(sql.split(/\s+/).slice(0, 2).join(" "));
          return { success: true, meta: { changes: 1 } };
        },
        first: async <T>() => (sql.startsWith("SELECT * FROM sessions") ? (row as T | null) : null),
      }),
    }),
  };
  return { db, writes };
}

const open: Row = { status: "active", name: "Main", owner_email: "o@x" };

test("renaming a missing session writes nothing", async () => {
  const { db, writes } = fakeDb(null);
  const result = await sessionWrite(db, SESSION_SQL.S08_NAME, ["New", "s1", "o@x"]);
  assert.equal(result.meta.changes, 0);
  assert.deepEqual(writes, []);
});

test("renaming an open session runs the update", async () => {
  const { db, writes } = fakeDb(open);
  assert.equal((await sessionWrite(db, SESSION_SQL.S08_NAME, ["New", "s1", "o@x"])).meta.changes, 1);
  assert.deepEqual(writes, ["UPDATE sessions"]);
});

test("deleting a missing session writes nothing, an open one is deleted", async () => {
  const missing = fakeDb(null);
  assert.equal((await sessionWrite(missing.db, SESSION_SQL.S02_DELETE, ["s1", "o@x"])).meta.changes, 0);
  assert.deepEqual(missing.writes, []);
  const present = fakeDb(open);
  await sessionWrite(present.db, SESSION_SQL.S02_DELETE, ["s1", "o@x"]);
  assert.deepEqual(present.writes, ["DELETE FROM"]);
});

test("opening a session inserts without a lookup", async () => {
  const { db, writes } = fakeDb(open);
  await sessionWrite(db, SESSION_SQL.S01_OPEN, ["s1", "Main", "o@x"]);
  assert.deepEqual(writes, ["INSERT INTO"]);
});

test("a stuck turn on an archived session is refused before SQL", async () => {
  const { db, writes } = fakeDb({ ...open, status: "archived" });
  const applied = await transitionSessionRecord(db, { id: "s1", ownerEmail: "o@x" }, "turn_stuck", { command: "MarkTurnStuck", sql: "UPDATE sessions SET status = ?", to: "active", from: ["running"] });
  assert.equal(applied, false);
  assert.deepEqual(writes, []);
});

test("a started turn on an open session is applied", async () => {
  const { db, writes } = fakeDb(open);
  const applied = await transitionSessionRecord(db, { id: "s1", ownerEmail: "o@x" }, "turn_started", { command: "StartTurn", sql: "UPDATE sessions SET status = ?", to: "running", from: ["active"] });
  assert.equal(applied, true);
  assert.deepEqual(writes, ["UPDATE sessions"]);
});

test("pinning a missing session through Effect writes nothing", async () => {
  const ran: string[] = [];
  const database = { first: () => Effect.succeed(null), all: () => Effect.succeed([]), run: (sql: string) => Effect.sync(() => void ran.push(sql)) };
  const wrote = await Effect.runPromise(Effect.provideService(sessionWriteEffect(SESSION_SQL.S15_PIN, ["s1", "o@x"]), Database, database as never));
  assert.equal(wrote, false);
  assert.deepEqual(ran, []);
});
