import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { finishTurnRecord, heartbeatTurnRecord, readTurnRecord, startTurnRecord, turnIsLive } from "./turn-record";
import { sqliteD1 } from "./fsm/sqlite-d1";

const SCHEMA = `
CREATE TABLE turns (session_id TEXT PRIMARY KEY, owner_email TEXT, started_at TEXT, heartbeat_at TEXT, tools_running INTEGER);
`;

const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect) as Promise<A>;

test("a turn record starts, heartbeats, reads back, and finishes", async () => {
  const db = sqliteD1(SCHEMA) as never;
  const t0 = new Date("2026-11-08T12:00:00Z");
  const t1 = new Date("2026-11-08T12:01:00Z");
  await run(startTurnRecord(db, "s1", "o@x", t0));
  assert.equal((await run(readTurnRecord(db, "s1", "o@x")))?.heartbeatAt, t0.toISOString());
  assert.equal(await run(turnIsLive(db, "s1", "o@x", t1, 5 * 60_000)), true);
  await run(heartbeatTurnRecord(db, "s1", "o@x", 2, t1));
  assert.equal((await run(readTurnRecord(db, "s1", "o@x")))?.toolsRunning, 2);
  await run(finishTurnRecord(db, "s1", "o@x"));
  assert.equal(await run(readTurnRecord(db, "s1", "o@x")), null);
});

test("a heartbeat older than the stall window is not live", async () => {
  const db = sqliteD1(SCHEMA) as never;
  const t0 = new Date("2026-11-08T12:00:00Z");
  await run(startTurnRecord(db, "s1", "o@x", t0));
  assert.equal(await run(turnIsLive(db, "s1", "o@x", new Date(t0.getTime() + 6 * 60_000), 5 * 60_000)), false);
});
