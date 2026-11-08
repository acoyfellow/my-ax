import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { runDeadSessionScan, type DeadSessionDb } from "../../src/dead-session-program";
import { DEAD_SESSION_STALL_MS, AUTO_REVIVE_PREFIX } from "../../src/dead-session-detector";
import { applySessionEvent } from "../../src/fsm/session-status";
import { sqliteD1 } from "../../src/fsm/sqlite-d1";

const OWNER = "owner@example.com";

const SCHEMA = `
CREATE TABLE sessions (id TEXT PRIMARY KEY, owner_email TEXT, status TEXT, engine TEXT, updated_at TEXT);
CREATE TABLE conversation_entries (id INTEGER PRIMARY KEY, session_id TEXT, owner_email TEXT, ts TEXT, role TEXT, content TEXT, meta_json TEXT);
CREATE TABLE attention_items (id TEXT, owner_email TEXT, session_id TEXT, kind TEXT, created_at TEXT);
`;

test("a turn still working on one slow tool is marked interrupted, and archive then succeeds mid-turn", async () => {
  const db = sqliteD1(SCHEMA);
  const now = new Date("2026-11-08T12:00:00Z");
  const turnStarted = new Date(now.getTime() - DEAD_SESSION_STALL_MS - 60_000).toISOString();
  db.raw.prepare("INSERT INTO sessions VALUES ('s-1', ?, 'running', 'think', ?)").run(OWNER, turnStarted);
  db.raw.prepare("INSERT INTO conversation_entries VALUES (1, 's-1', ?, ?, 'user', 'run the long build', ?)").run(OWNER, turnStarted, JSON.stringify({ uiMessageId: `${AUTO_REVIVE_PREFIX}1` }));

  const agentStillWorking = true;
  const settled: string[] = [];
  await Effect.runPromise(runDeadSessionScan(db as unknown as DeadSessionDb, {
    reviveTurn: async () => undefined,
    alertOwner: async () => undefined,
    settleRunningWithoutTurn: async (_owner, id) => { settled.push(id); },
  }, now));

  const afterScan = db.raw.prepare("SELECT status FROM sessions WHERE id='s-1'").get() as { status: string };
  assert.equal(agentStillWorking, true);
  assert.equal(afterScan.status, "interrupted", "the scan marks the session interrupted although the agent is still mid-turn");
  assert.deepEqual(settled, [], "it never asked the agent whether a turn is live");

  const archived = await applySessionEvent(db, { id: "s-1", ownerEmail: OWNER }, "archived");
  assert.equal(archived, true, "archive is accepted while the turn is still running");
});
