import assert from "node:assert/strict";
import { test } from "node:test";
import { applyRunEvent, nextRunStatus, ownerTerminalEvent, RUN_TRANSITIONS, TERMINAL_RUN_STATUSES, type RunStatus } from "./run-status";
import { sqliteD1 } from "./sqlite-d1";

const SCHEMA = "CREATE TABLE runs (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT '')";
const run = { id: "r1", ownerEmail: "owner@example.com" };

function dbWith(status: RunStatus) {
  const db = sqliteD1(SCHEMA);
  db.raw.prepare("INSERT INTO runs (id, owner_email, status) VALUES (?, ?, ?)").run(run.id, run.ownerEmail, status);
  return { db, status: () => (db.raw.prepare("SELECT status FROM runs").get() as { status: string }).status };
}

test("a recipe that finishes after the owner aborted its run does not overwrite the abort", async () => {
  const { db, status } = dbWith("aborted");
  assert.equal(await applyRunEvent(db, run, "recipe_succeeded"), false);
  assert.equal(status(), "aborted");
});

test("a late receipt does not move a finished run back to running", async () => {
  const { db, status } = dbWith("completed");
  assert.equal(await applyRunEvent(db, run, "receipt_recorded"), false);
  assert.equal(status(), "completed");
});

test("the first receipt moves an open run to running", async () => {
  const { db, status } = dbWith("open");
  assert.equal(await applyRunEvent(db, run, "receipt_recorded"), true);
  assert.equal(status(), "running");
});

test("no event leaves a terminal state except reopening an answered decision", () => {
  for (const [event, transition] of Object.entries(RUN_TRANSITIONS)) {
    const leavesTerminal = transition.from.some((from) => TERMINAL_RUN_STATUSES.includes(from));
    assert.equal(leavesTerminal, event === "decision_reopened", event);
  }
});

test("the owner can end only a live run", () => {
  for (const status of ["completed", "failed", "aborted"] as const) {
    for (const terminal of TERMINAL_RUN_STATUSES) assert.equal(nextRunStatus(status, ownerTerminalEvent(terminal)), null);
  }
  assert.equal(nextRunStatus("running", ownerTerminalEvent("aborted")), "aborted");
});
