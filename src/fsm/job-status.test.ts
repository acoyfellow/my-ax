import assert from "node:assert/strict";
import { test } from "node:test";
import { CLAIM_RUN_SQL, markJobPaused, markJobResumed, nextJobStatus, saveJobEdit, type JobStatus } from "./job-status";
import { sqliteD1 } from "./sqlite-d1";

const SCHEMA = `CREATE TABLE jobs (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, session_id TEXT, thread_mode TEXT, name TEXT, prompt TEXT,
  cadence_secs INTEGER, max_runs INTEGER, run_count INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, next_run_at TEXT, schedule_id TEXT, updated_at TEXT)`;
const job = { id: "j1", ownerEmail: "owner@example.com" };

function dbWith(status: JobStatus, runCount = 0, maxRuns: number | null = null) {
  const db = sqliteD1(SCHEMA);
  db.raw.prepare("INSERT INTO jobs (id, owner_email, status, run_count, max_runs, schedule_id) VALUES (?, ?, ?, ?, ?, 'sched-0')").run(job.id, job.ownerEmail, status, runCount, maxRuns);
  return { db, row: () => ({ ...(db.raw.prepare("SELECT status, schedule_id, run_count FROM jobs").get() as object) }) as { status: string; schedule_id: string | null; run_count: number } };
}

test("resume cannot bring an exhausted job back to active", async () => {
  const { db, row } = dbWith("exhausted");
  assert.equal(await markJobResumed(db, job, "sched-1", "2030-01-01T00:00:00.000Z"), false);
  assert.equal(row().status, "exhausted");
});

test("pause after the job ran out does not hide that it is exhausted", async () => {
  const { db, row } = dbWith("exhausted");
  assert.equal(await markJobPaused(db, job), false);
  assert.equal(row().status, "exhausted");
});

test("an edit races a run that exhausts the job; the edit loses instead of reviving it", async () => {
  const { db, row } = dbWith("active", 0, 1);
  db.raw.prepare(CLAIM_RUN_SQL).all(job.id, job.ownerEmail);
  assert.equal(row().status, "exhausted");
  const saved = await saveJobEdit(db, job, "active", { sessionId: "s", threadMode: "same_session", name: "n", prompt: "p", cadenceSecs: 60, maxRuns: 5, status: "active", nextRunAt: null, scheduleId: "sched-2" });
  assert.equal(saved, false);
  assert.equal(row().status, "exhausted");
});

test("the last allowed run exhausts the job and clears its schedule", async () => {
  const { db, row } = dbWith("active", 2, 3);
  db.raw.prepare(CLAIM_RUN_SQL).all(job.id, job.ownerEmail);
  assert.deepEqual(row(), { status: "exhausted", schedule_id: null, run_count: 3 });
});

test("an exhausted job only stays exhausted", async () => {
  for (const event of ["paused", "resumed", "run_claimed"] as const) assert.equal(nextJobStatus("exhausted", event), null);
  assert.equal(nextJobStatus("exhausted", "edited", { exhaustedAfter: true }), "exhausted");
  await assert.rejects(() => saveJobEdit({ prepare: () => { throw new Error("unreachable"); } }, job, "exhausted", { sessionId: "s", threadMode: "t", name: "n", prompt: "p", cadenceSecs: 60, maxRuns: null, status: "active", nextRunAt: null, scheduleId: null }));
});
