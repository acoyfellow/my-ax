import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainRejected } from "./decide";
import { claimJobRun, createJobRecord, deleteSessionJobs, INSERT_JOB_SQL, jobWrite, PAUSE_JOB_SQL, RESUME_JOB_SQL, SET_JOB_ERROR_SQL } from "./Job/Job.store";
import { testDb } from "./test-db";

const OWNER = "o@x";

function insertBinds(id: string, maxRuns: number | null) {
  return [id, OWNER, "s1", "same_session", "n", "p", 60, maxRuns, "2026-01-01T00:00:00Z", null];
}

async function withJob(status = "active", runCount = 0, maxRuns: number | null = null, id = "j1") {
  const db = testDb();
  db.exec(`INSERT OR IGNORE INTO sessions (id, name, status, owner_email) VALUES ('s1', 'Main', 'active', '${OWNER}')`);
  await createJobRecord(db, { id, ownerEmail: OWNER, name: "n", prompt: "p", cadenceSecs: 60, maxRuns }, INSERT_JOB_SQL, insertBinds(id, maxRuns));
  db.exec(`UPDATE jobs SET status = '${status}', run_count = ${runCount} WHERE id = '${id}'`);
  db.writes.length = 0;
  return db;
}

function row(db: ReturnType<typeof testDb>, id = "j1") {
  return db.rows<{ status: string; run_count: number; last_error: string | null }>("SELECT status, run_count, last_error FROM jobs WHERE id = ?", id)[0] ?? null;
}

test("pausing a paused job is refused before any SQL", async () => {
  const db = await withJob("paused");
  const result = await jobWrite(db, "j1", OWNER, { kind: "pause" }, PAUSE_JOB_SQL, ["j1", OWNER]);
  assert.equal(result.meta?.changes, 0);
  assert.deepEqual(db.writes, []);
});

test("resuming a paused job sends the guarded update", async () => {
  const db = await withJob("paused");
  const result = await jobWrite(db, "j1", OWNER, { kind: "resume" }, RESUME_JOB_SQL, ["s", "t", "j1", OWNER]);
  assert.equal(result.meta?.changes, 1);
  assert.deepEqual(db.writes, ["UPDATE jobs SET"]);
  assert.equal(row(db)?.status, "active");
});

test("an exhausted job cannot be claimed or resumed", async () => {
  const db = await withJob("exhausted", 3, 3);
  assert.equal(await claimJobRun(db, "j1", OWNER), null);
  assert.equal((await jobWrite(db, "j1", OWNER, { kind: "resume" }, RESUME_JOB_SQL, ["s", "t", "j1", OWNER])).meta?.changes, 0);
  assert.deepEqual(db.writes, []);
  assert.equal(row(db)?.run_count, 3);
});

test("an active job is claimed through Domain and its run count grows", async () => {
  const db = await withJob("active");
  const claimed = await claimJobRun(db, "j1", OWNER);
  assert.deepEqual({ ...claimed }, { max_runs: null, run_count: 1, status: "active" });
  assert.deepEqual(db.writes, ["UPDATE jobs SET"]);
  assert.equal(row(db)?.run_count, 1);
});

test("bookkeeping on a missing job writes nothing", async () => {
  const db = testDb();
  assert.equal((await jobWrite(db, "j1", OWNER, { kind: "bookkeeping" }, SET_JOB_ERROR_SQL, ["e", "j1", OWNER])).meta?.changes, 0);
  assert.deepEqual(db.writes, []);
});

test("a job is created once through Domain", async () => {
  const db = testDb();
  db.exec(`INSERT INTO sessions (id, name, status, owner_email) VALUES ('s1', 'Main', 'active', '${OWNER}')`);
  db.writes.length = 0;
  await createJobRecord(db, { id: "j1", ownerEmail: OWNER, name: "n", prompt: "p", cadenceSecs: 60, maxRuns: null }, INSERT_JOB_SQL, insertBinds("j1", null));
  assert.deepEqual(db.writes, ["INSERT INTO jobs"]);
  assert.equal(row(db)?.status, "active");
});

test("deleting a session's jobs decides each job, then deletes", async () => {
  const db = await withJob("active");
  await createJobRecord(db, { id: "j2", ownerEmail: OWNER, name: "n", prompt: "p", cadenceSecs: 60, maxRuns: 1 }, INSERT_JOB_SQL, insertBinds("j2", 1));
  db.exec("UPDATE jobs SET status = 'exhausted', run_count = 1 WHERE id = 'j2'");
  db.writes.length = 0;
  await deleteSessionJobs(db, "s1", OWNER);
  assert.deepEqual(db.writes, ["DELETE FROM jobs"]);
  assert.equal(row(db, "j1"), null);
  assert.equal(row(db, "j2"), null);
  assert.equal(DomainRejected.name, "DomainRejected");
});
