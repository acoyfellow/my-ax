import assert from "node:assert/strict";
import { test } from "node:test";
import { JobService, JobServiceError } from "../../src/job-service";
import { CLAIM_RUN_SQL } from "../../src/fsm/job-status";
import { sqliteD1 } from "../../src/fsm/sqlite-d1";
import type { Env } from "../../src/types";
import type { JobRow } from "../../src/jobs";

const OWNER = "owner@example.com";

const SCHEMA = `
CREATE TABLE jobs (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, session_id TEXT, thread_mode TEXT, name TEXT, prompt TEXT,
  cadence_secs INTEGER, max_runs INTEGER, run_count INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, next_run_at TEXT,
  last_run_at TEXT, last_error TEXT, schedule_id TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE job_events (id TEXT PRIMARY KEY, job_id TEXT, owner_email TEXT, action TEXT, ok INTEGER, detail_json TEXT, idempotency_key TEXT, created_at TEXT);
`;

function harness() {
  const db = sqliteD1(SCHEMA);
  db.raw.prepare("INSERT INTO jobs (id, owner_email, session_id, thread_mode, name, prompt, cadence_secs, max_runs, run_count, status, next_run_at, schedule_id) VALUES ('job-1', ?, 's-1', 'same_session', 'n', 'p', 60, 2, 1, 'active', 'x', 'alarm-1')").run(OWNER);
  const live = new Set<string>(["alarm-1"]);
  let next = 2;
  const claimDuringPause = { armed: true };

  const runtime = {
    async schedule() {
      const id = `alarm-${next++}`;
      live.add(id);
      return id;
    },
    async cancel(_env: Env, row: Pick<JobRow, "schedule_id">) {
      if (row.schedule_id) live.delete(row.schedule_id);
      if (claimDuringPause.armed) {
        claimDuringPause.armed = false;
        await db.prepare(CLAIM_RUN_SQL).bind("job-1", OWNER).first();
      }
    },
    async run() {
      return { ok: true };
    },
  };

  const env = { DB: db } as unknown as Env;
  return { db, live, service: new JobService(env, OWNER, () => new Date("2026-01-01T00:00:00Z"), runtime as never) };
}

test("pausing while the last allowed run is claimed must not leave an out-of-runs job with a live alarm", async () => {
  const { db, live, service } = harness();

  await assert.rejects(service.setPaused("job-1", true), (error: unknown) => error instanceof JobServiceError && error.code === "Conflict");

  const row = db.raw.prepare("SELECT status, run_count, schedule_id FROM jobs WHERE id='job-1'").get() as { status: string; run_count: number; schedule_id: string | null };
  assert.equal(row.status, "exhausted");
  assert.equal(row.run_count, 2);
  assert.deepEqual([...live], [], "the pause rollback must not schedule a fresh alarm for a job that has no runs left");
  assert.equal(row.schedule_id, null, "and must not write an alarm id onto the exhausted job row");
});
