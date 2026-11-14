import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { applyRunEvent } from "../fsm/run-status";
import { applySessionEvent, SESSION_TRANSITIONS, type SessionStatus, type SessionStatusEvent } from "../fsm/session-status";
import { markJobPaused, markJobResumed } from "../fsm/job-status";
import { sqliteD1 } from "../fsm/sqlite-d1";
import { shadowRecipe, shadowSession, type ShadowRecord } from "./shadow";

const SCHEMA = `
CREATE TABLE sessions (id TEXT PRIMARY KEY, owner_email TEXT, status TEXT, updated_at TEXT);
CREATE TABLE runs (id TEXT PRIMARY KEY, owner_email TEXT, status TEXT, updated_at TEXT);
CREATE TABLE jobs (id TEXT PRIMARY KEY, owner_email TEXT, status TEXT, schedule_id TEXT, next_run_at TEXT, updated_at TEXT);
`;

const OWNER = "owner@example.com";
let logged: Array<{ level: string; tag: string; record: ShadowRecord }> = [];
const original = { info: console.info, warn: console.warn };

beforeEach(() => {
  logged = [];
  console.info = (tag: string, record: ShadowRecord) => { logged.push({ level: "info", tag, record }); };
  console.warn = (tag: string, record: ShadowRecord) => { logged.push({ level: "warn", tag, record }); };
});
afterEach(() => {
  console.info = original.info;
  console.warn = original.warn;
});

test("every real session transition is shadowed, and Domain agrees with the SQL every time", async () => {
  for (const status of ["active", "running", "error", "interrupted", "archived"] as SessionStatus[]) {
    for (const event of Object.keys(SESSION_TRANSITIONS) as SessionStatusEvent[]) {
      const db = sqliteD1(SCHEMA);
      db.raw.prepare("INSERT INTO sessions VALUES ('s1', ?, ?, 't')").run(OWNER, status);
      await applySessionEvent(db, { id: "s1", ownerEmail: OWNER }, event);
    }
  }
  assert.equal(logged.length, 60);
  assert.deepEqual(logged.filter((entry) => !entry.record.agree), []);
  assert.ok(logged.every((entry) => entry.tag === "domain.shadow"));
});

test("a run transition and a job pause and resume are shadowed and agree", async () => {
  const db = sqliteD1(SCHEMA);
  db.raw.prepare("INSERT INTO runs VALUES ('r1', ?, 'open', 't')").run(OWNER);
  db.raw.prepare("INSERT INTO jobs VALUES ('j1', ?, 'active', 'sch', NULL, 't')").run(OWNER);
  await applyRunEvent(db, { id: "r1", ownerEmail: OWNER }, "receipt_recorded");
  await applyRunEvent(db, { id: "r1", ownerEmail: OWNER }, "decision_answered");
  await markJobPaused(db, { id: "j1", ownerEmail: OWNER });
  await markJobPaused(db, { id: "j1", ownerEmail: OWNER });
  await markJobResumed(db, { id: "j1", ownerEmail: OWNER }, "sch2", "t2");
  assert.deepEqual(logged.map((entry) => [entry.record.aggregate, entry.record.sql, entry.record.agree]), [
    ["Run", "accepted", true],
    ["Run", "rejected", true],
    ["Job", "accepted", true],
    ["Job", "rejected", true],
    ["Job", "accepted", true],
  ]);
});

test("run transitions are enforced by Domain: accepted, refused, missing", async () => {
  const db = sqliteD1(SCHEMA);
  db.raw.prepare("INSERT INTO runs VALUES ('r1', ?, 'open', 't')").run(OWNER);
  assert.equal(await applyRunEvent(db, { id: "r1", ownerEmail: OWNER }, "receipt_recorded"), true);
  assert.equal(await applyRunEvent(db, { id: "r1", ownerEmail: OWNER }, "decision_answered"), false);
  assert.equal(await applyRunEvent(db, { id: "missing", ownerEmail: OWNER }, "receipt_recorded"), false);
  assert.equal(db.raw.prepare("SELECT status FROM runs WHERE id = 'r1'").get()?.status, "running");
});

test("a disagreement is logged as a warning", () => {
  const record = shadowSession("archived", OWNER, "running", "accepted");
  assert.equal(record?.agree, false);
  assert.equal(record?.domain, "rejected");
  const recipe = shadowRecipe("enabled", OWNER, "pending", "rejected");
  assert.equal(recipe?.agree, true);
});

test("the shadow never changes what the SQL did", async () => {
  const db = sqliteD1(SCHEMA);
  db.raw.prepare("INSERT INTO sessions VALUES ('s1', ?, 'active', 't')").run(OWNER);
  console.info = () => { throw new Error("logging broke"); };
  assert.equal(await applySessionEvent(db, { id: "s1", ownerEmail: OWNER }, "turn_started"), true);
  assert.equal((db.raw.prepare("SELECT status FROM sessions").get() as { status: string }).status, "running");
});

test("a database without first() still applies the transition and skips the shadow", async () => {
  const db = sqliteD1(SCHEMA);
  db.raw.prepare("INSERT INTO sessions VALUES ('s1', ?, 'active', 't')").run(OWNER);
  const noFirst = { prepare: (sql: string) => ({ bind: (...values: unknown[]) => ({ run: () => db.prepare(sql).bind(...values).run() }) }) };
  assert.equal(await applySessionEvent(noFirst, { id: "s1", ownerEmail: OWNER }, "turn_started"), true);
  assert.equal(logged.length, 0);
});
