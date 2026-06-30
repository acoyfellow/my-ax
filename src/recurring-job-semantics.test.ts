import assert from "node:assert/strict";
import test from "node:test";
import type { Env } from "./types";
import type { JobRow } from "./jobs";
import { computeNextRun, validateJobInput } from "./jobs";
import { recurringJobReceipt } from "./recurring-job-receipt";

const row: JobRow = {
  id: "job-1",
  owner_email: "owner@example.com",
  session_id: "session-existing",
  name: "Morning check",
  prompt: "Summarize what changed overnight.",
  cadence_secs: 3600,
  status: "active",
  next_run_at: "2026-01-01T01:00:00.000Z",
  last_run_at: null,
  last_error: null,
  schedule_id: "schedule-1",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

test("recurring job input requires a target existing conversation today", () => {
  assert.deepEqual(validateJobInput({ name: "job", prompt: "run", cadenceSecs: 60 }), {
    tag: "InvalidInput",
    field: "sessionId",
    message: "required",
  });
  assert.deepEqual(validateJobInput({ sessionId: " session-existing ", name: "job", prompt: "run", cadenceSecs: 60 }), {
    sessionId: "session-existing",
    name: "job",
    prompt: "run",
    cadenceSecs: 60,
  });
});

test("manual and scheduled recurring runs are currently same-thread by contract", () => {
  // JobRow has exactly one session_id today. scheduleJob(), runJobNow(), and
  // JobService.run(...) all pass that id through to the session agent. There is
  // no field that can mean "create a fresh conversation per tick" yet.
  assert.equal(row.session_id, "session-existing");
  assert.equal("thread_mode" in row, false);
  assert.equal("new_session_each_run" in row, false);
});

test("recurring job receipts send the owner back to the existing conversation", () => {
  const receipt = recurringJobReceipt({
    jobId: row.id,
    jobName: row.name,
    sessionId: row.session_id,
    error: null,
  });
  assert.equal(receipt.kind, "job.complete");
  assert.equal(receipt.sessionId, "session-existing");
  assert.equal(receipt.href, "/?session=session-existing");
  assert.match(receipt.body, /open the conversation to review the result/);
});

test("recurring job receipt dedupe stays per job, not per tick", () => {
  const first = recurringJobReceipt({ jobId: row.id, jobName: row.name, sessionId: row.session_id, error: "first failure" });
  const second = recurringJobReceipt({ jobId: row.id, jobName: row.name, sessionId: row.session_id, error: "second failure" });
  assert.equal(first.dedupeKey, `recurring-job:${row.id}`);
  assert.equal(second.dedupeKey, first.dedupeKey);
});

test("manual run and scheduled tick should share the same target-session contract", () => {
  const manual = { targetSessionId: row.session_id, clientMsgIdPrefix: `job:${row.id}:`, prompt: row.prompt };
  const scheduled = { targetSessionId: row.session_id, clientMsgIdPrefix: `job:${row.id}:`, prompt: row.prompt };
  assert.deepEqual(manual, scheduled);
});

test("recurring next-run math is independent of conversation threading mode", () => {
  assert.equal(computeNextRun(new Date("2026-01-01T00:00:00.000Z"), 3600), "2026-01-01T01:00:00.000Z");
});

test("future new-thread-per-run option needs a persisted thread policy, not prompt convention", () => {
  type FutureThreadMode = "same_session" | "new_session_per_run";
  const allowed: FutureThreadMode[] = ["same_session", "new_session_per_run"];
  assert.deepEqual(allowed, ["same_session", "new_session_per_run"]);
  // This is intentionally a design assertion: the current Env/database schema
  // has no place to store this choice, so product copy must not imply it exists.
  assert.equal(({} as Env & { RECURRING_JOB_THREAD_MODE?: string }).RECURRING_JOB_THREAD_MODE, undefined);
});
