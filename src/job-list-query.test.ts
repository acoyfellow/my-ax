import assert from "node:assert/strict";
import test from "node:test";
import { parseJobListQuery, queryJobList, type JobListRow } from "./job-list-query";

const rows: JobListRow[] = Array.from({ length: 30 }, (_, index) => ({
  id: `job-${index}`,
  name: index === 27 ? "Lee sprint closure loop" : `Job ${index}`,
  status: index === 27 || index % 2 === 0 ? "active" : "paused",
}));

test("a job past the old 20-row cut is found by name and status in one call", () => {
  const result = queryJobList(rows, parseJobListQuery({ status: "active", nameContains: "lee" }));
  assert.deepEqual(result.jobs.map((job) => job.id), ["job-27"]);
  assert.equal(result.matchingJobs, 1);
  assert.equal(result.hasMore, false);
});

test("every result states how much it covered", () => {
  const result = queryJobList(rows, { limit: 10 });
  assert.equal(result.returned, 10);
  assert.equal(result.totalJobs, 30);
  assert.equal(result.hasMore, true);
  assert.equal(result.coverage, "10 of 30 matching jobs (30 total)");
});

test("offset pages through the rest", () => {
  const result = queryJobList(rows, { limit: 25, offset: 25 });
  assert.deepEqual(result.jobs.map((job) => job.id), ["job-25", "job-26", "job-27", "job-28", "job-29"]);
  assert.equal(result.hasMore, false);
});

test("rows are slim: no prompts or other heavy fields", () => {
  const heavy = [{ ...rows[0], prompt: "x".repeat(10_000) } as JobListRow];
  assert.deepEqual(Object.keys(queryJobList(heavy, {}).jobs[0]).sort(), ["cadence_secs", "id", "last_run_at", "name", "next_run_at", "status"]);
});
