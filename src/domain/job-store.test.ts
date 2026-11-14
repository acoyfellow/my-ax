import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainRejected } from "./decide";
import { claimJobRun, createJobRecord, deleteSessionJobs, INSERT_JOB_SQL, jobWrite, PAUSE_JOB_SQL, RESUME_JOB_SQL, SET_JOB_ERROR_SQL } from "./Job/Job.store";

type Row = { status: string; name: string; prompt: string; cadence_secs: number; max_runs: number | null; run_count: number } | null;

function fakeDb(row: Row, listed: Array<Row & { id: string }> = []) {
  const writes: string[] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: () => ({
        run: async () => {
          writes.push(sql.trim().split(/\s+/).slice(0, 3).join(" "));
          return { meta: { changes: 1 } };
        },
        first: async <T>() => {
          if (/^SELECT (status|\*) /.test(sql)) return row as T | null;
          writes.push(sql.trim().split(/\s+/).slice(0, 3).join(" "));
          return { max_runs: null, run_count: 1, status: "active" } as T;
        },
        all: async <T>() => ({ results: listed as T[] }),
      }),
    }),
  };
  return { db, writes };
}

const job = (status: string, runCount = 0, maxRuns: number | null = null) => ({ status, name: "n", prompt: "p", cadence_secs: 60, max_runs: maxRuns, run_count: runCount });

test("pausing a paused job is refused before any SQL", async () => {
  const { db, writes } = fakeDb(job("paused"));
  const result = await jobWrite(db, "j1", "o@x", { kind: "pause" }, PAUSE_JOB_SQL, ["j1", "o@x"]);
  assert.equal(result.meta?.changes, 0);
  assert.deepEqual(writes, []);
});

test("resuming a paused job sends the guarded update", async () => {
  const { db, writes } = fakeDb(job("paused"));
  const result = await jobWrite(db, "j1", "o@x", { kind: "resume" }, RESUME_JOB_SQL, ["s", "t", "j1", "o@x"]);
  assert.equal(result.meta?.changes, 1);
  assert.deepEqual(writes, ["UPDATE jobs SET"]);
});

test("an exhausted job cannot be claimed or resumed", async () => {
  const { db, writes } = fakeDb(job("exhausted", 3, 3));
  assert.equal(await claimJobRun(db, "j1", "o@x"), null);
  assert.equal((await jobWrite(db, "j1", "o@x", { kind: "resume" }, RESUME_JOB_SQL, [])).meta?.changes, 0);
  assert.deepEqual(writes, []);
});

test("an active job is claimed through Domain", async () => {
  const { db, writes } = fakeDb(job("active"));
  assert.deepEqual(await claimJobRun(db, "j1", "o@x"), { max_runs: null, run_count: 1, status: "active" });
  assert.deepEqual(writes, ["UPDATE jobs SET"]);
});

test("bookkeeping on a missing job writes nothing", async () => {
  const { db, writes } = fakeDb(null);
  assert.equal((await jobWrite(db, "j1", "o@x", { kind: "bookkeeping" }, SET_JOB_ERROR_SQL, ["e", "j1", "o@x"])).meta?.changes, 0);
  assert.deepEqual(writes, []);
});

test("a job is created once through Domain", async () => {
  const { db, writes } = fakeDb(null);
  await createJobRecord(db, { id: "j1", ownerEmail: "o@x", name: "n", prompt: "p", cadenceSecs: 60, maxRuns: null }, INSERT_JOB_SQL, []);
  assert.deepEqual(writes, ["INSERT INTO jobs"]);
});

test("deleting a session's jobs decides each job, then deletes", async () => {
  const { db, writes } = fakeDb(null, [{ id: "j1", ...job("active") }, { id: "j2", ...job("exhausted", 1, 1) }]);
  await deleteSessionJobs(db, "s1", "o@x");
  assert.deepEqual(writes, ["DELETE FROM jobs"]);
  assert.equal(DomainRejected.name, "DomainRejected");
});
