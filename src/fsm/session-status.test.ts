import assert from "node:assert/strict";
import { test } from "node:test";
import { applySessionEvent, nextSessionStatus, type SessionStatus } from "./session-status";
import { sqliteD1 } from "./sqlite-d1";

const SCHEMA = "CREATE TABLE sessions (id TEXT PRIMARY KEY, status TEXT NOT NULL, owner_email TEXT NOT NULL, updated_at TEXT NOT NULL)";
const session = { id: "s1", ownerEmail: "owner@example.com" };

function dbWith(status: SessionStatus, updatedAt = "2000-01-01 00:00:00") {
  const db = sqliteD1(SCHEMA);
  db.raw.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?)").run(session.id, status, session.ownerEmail, updatedAt);
  const row = () => ({ ...(db.raw.prepare("SELECT status, updated_at FROM sessions").get() as { status: string; updated_at: string }) });
  return { db, row };
}

test("a turn that finishes cannot revive a session the stuck watchdog already reset", async () => {
  const { db, row } = dbWith("active");
  assert.equal(await applySessionEvent(db, session, "turn_stuck"), false);
  assert.equal(row().status, "active");
});

test("recovery exhaustion does not overwrite a session that already failed", async () => {
  const { db, row } = dbWith("error");
  assert.equal(await applySessionEvent(db, session, "recovery_exhausted"), false);
  assert.equal(row().status, "error");
});

test("a real completion clears an interrupted guess from the dead-session detector", async () => {
  const { db, row } = dbWith("interrupted");
  assert.equal(await applySessionEvent(db, session, "turn_completed"), true);
  assert.equal(row().status, "active");
});

test("the dead-session detector keeps updated_at so the session does not jump to the top", async () => {
  const { db, row } = dbWith("running");
  assert.equal(await applySessionEvent(db, session, "dead_session_detected"), true);
  assert.deepEqual(row(), { status: "interrupted", updated_at: "2000-01-01 00:00:00" });
});

test("another owner's session is never changed", async () => {
  const { db, row } = dbWith("running");
  assert.equal(await applySessionEvent(db, { ...session, ownerEmail: "other@example.com" }, "turn_completed"), false);
  assert.equal(row().status, "running");
});

test("every status can start a new turn", () => {
  for (const status of ["active", "running", "error", "interrupted"] as const) assert.equal(nextSessionStatus(status, "turn_started"), "running");
});

test("the Pi engine never overwrites an interrupted session and keeps updated_at when a run settles", async () => {
  const interrupted = dbWith("interrupted");
  assert.equal(await applySessionEvent(interrupted.db, session, "pi_run_started"), false);
  assert.equal(await applySessionEvent(interrupted.db, session, "pi_run_settled"), false);
  const running = dbWith("running");
  assert.equal(await applySessionEvent(running.db, session, "pi_run_settled"), true);
  assert.deepEqual(running.row(), { status: "active", updated_at: "2000-01-01 00:00:00" });
});

test("only an idle session can be archived, and unarchive returns it to active", async () => {
  for (const status of ["active", "error", "interrupted"] as const) assert.equal(nextSessionStatus(status, "archived"), "archived");
  assert.equal(nextSessionStatus("running", "archived"), null);
  assert.equal(nextSessionStatus("archived", "unarchived"), "active");
  assert.equal(nextSessionStatus("active", "unarchived"), null);
  const running = dbWith("running");
  assert.equal(await applySessionEvent(running.db, session, "archived"), false);
  assert.equal(running.row().status, "running");
});

test("a new turn in an archived session brings it back", () => {
  assert.equal(nextSessionStatus("archived", "turn_started"), "running");
});
