import assert from "node:assert/strict";
import { test } from "node:test";
import { decide, DomainRejected } from "./decide";
import { dailyRefusals, flushRefusals, refusalCounts, resetRefusalCounts, setRefusalSink } from "./refusals";
import { readFileSync } from "node:fs";
import { sqliteD1 } from "../fsm/sqlite-d1";

const REFUSALS_SCHEMA = readFileSync(new URL("../../migrations/0042_domain_refusals.sql", import.meta.url), "utf8");
import { Job } from "./Job/Job.aggregate";
import { PauseJob } from "./Job/PauseJob.command";

function captureWarnings(work: () => void): unknown[][] {
  const seen: unknown[][] = [];
  const previous = setRefusalSink((tag, refusal) => void seen.push([tag, refusal]));
  try {
    work();
  } finally {
    setRefusalSink(previous);
  }
  return seen;
}

test("a refused decision is logged as domain.refused and counted", () => {
  resetRefusalCounts();
  const logs = captureWarnings(() => {
    assert.throws(() => decide(Job, "j1", { _tag: "Unscheduled" }, new PauseJob()), DomainRejected);
  });
  assert.equal(logs.length, 1);
  assert.equal(logs[0][0], "domain.refused");
  assert.deepEqual(logs[0][1], { aggregate: "Job", command: "PauseJob", rejection: "JobNotFound" });
  assert.deepEqual(refusalCounts(), { "Job.PauseJob.JobNotFound": 1 });
});

test("refusals are flushed into a per-day count and read back", async () => {
  resetRefusalCounts();
  const db = sqliteD1(REFUSALS_SCHEMA);
  captureWarnings(() => {
    for (let attempt = 0; attempt < 3; attempt += 1) assert.throws(() => decide(Job, "j1", { _tag: "Unscheduled" }, new PauseJob()), DomainRejected);
  });
  const day = new Date("2026-11-15T10:00:00Z");
  assert.equal(await flushRefusals(db, day), 1);
  captureWarnings(() => assert.throws(() => decide(Job, "j1", { _tag: "Unscheduled" }, new PauseJob()), DomainRejected));
  await flushRefusals(db, day);
  assert.deepEqual(await dailyRefusals(db, "2026-11-15"), { "Job.PauseJob.JobNotFound": 4 });
  assert.deepEqual(await dailyRefusals(db, "2026-11-14"), {});
  assert.deepEqual(refusalCounts(), {});
});

test("an accepted decision is not logged or counted", () => {
  resetRefusalCounts();
  const logs = captureWarnings(() => {
    decide(Job, "j1", { _tag: "Active", ownerEmail: "o@x", name: "n", prompt: "p", cadenceSecs: 60, maxRuns: null, runCount: 0 }, new PauseJob());
  });
  assert.equal(logs.length, 0);
  assert.deepEqual(refusalCounts(), {});
});
