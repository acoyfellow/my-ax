import assert from "node:assert/strict";
import test from "node:test";
import type { JobRow } from "./jobs";
import { computeNextRun, resolveRecurringJobTargetSession, validateJobInput } from "./jobs";
import { recurringJobReceipt } from "./recurring-job-receipt";
import type { Env } from "./types";

const row: JobRow = {
  id: "job-1",
  owner_email: "owner@example.com",
  session_id: "session-existing",
  thread_mode: "same_session",
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

test("recurring job input requires a target conversation and defaults new jobs to fresh conversations", () => {
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
    threadMode: "new_session_per_run",
  });
});

test("recurring job input accepts explicit same-session standing loops", () => {
  assert.deepEqual(validateJobInput({ sessionId: "session-existing", name: "job", prompt: "run", cadenceSecs: 60, threadMode: "same_session" }), {
    sessionId: "session-existing",
    name: "job",
    prompt: "run",
    cadenceSecs: 60,
    threadMode: "same_session",
  });
});

test("recurring job thread mode is now persisted, not prompt convention", () => {
  assert.equal(row.thread_mode, "same_session");
  assert.equal("thread_mode" in row, true);
});

test("specific_session is a valid third destination and requires a thread id (no guess/fallback)", () => {
  // Missing id -> actionable, Specific-aware error (not a bare "required"),
  // never silent fallback to current/new.
  assert.deepEqual(validateJobInput({ name: "job", prompt: "run", cadenceSecs: 60, threadMode: "specific_session" }), {
    tag: "InvalidInput", field: "sessionId", message: "a Specific thread requires a thread id",
  });
  // Empty-after-trim id with specific -> same actionable message.
  assert.deepEqual(validateJobInput({ sessionId: "   ", name: "job", prompt: "run", cadenceSecs: 60, threadMode: "specific_session" }), {
    tag: "InvalidInput", field: "sessionId", message: "a Specific thread requires a thread id",
  });
  // A non-specific mode with a blank id still gets the plain "required".
  assert.deepEqual(validateJobInput({ name: "job", prompt: "run", cadenceSecs: 60, threadMode: "same_session" }), {
    tag: "InvalidInput", field: "sessionId", message: "required",
  });
  // Valid specific target normalizes and preserves the mode.
  assert.deepEqual(validateJobInput({ sessionId: " session-x ", name: "job", prompt: "run", cadenceSecs: 60, threadMode: "specific_session" }), {
    sessionId: "session-x", name: "job", prompt: "run", cadenceSecs: 60, threadMode: "specific_session",
  });
});

test("an unknown thread mode is rejected with all three valid options named", () => {
  const err = validateJobInput({ sessionId: "s", name: "j", prompt: "p", cadenceSecs: 60, threadMode: "bogus" as never });
  assert.equal((err as { field: string }).field, "threadMode");
  assert.match((err as { message: string }).message, /specific_session/);
});

test("specific_session dispatch reuses the stored (owner-chosen) session, never mints one", async () => {
  const specificRow: JobRow = { ...row, thread_mode: "specific_session", session_id: "session-chosen" };
  const env = { DB: { prepare() { throw new Error("specific_session must not create a session"); } } } as unknown as Env;
  assert.deepEqual(await resolveRecurringJobTargetSession(env, specificRow, new Date("2026-01-01T00:00:00.000Z")), {
    targetSessionId: "session-chosen",
    sourceSessionId: "session-chosen",
    threadMode: "specific_session",
    created: false,
  });
});

test("legacy rows (both existing modes) remain valid after adding the third mode", () => {
  for (const mode of ["same_session", "new_session_per_run"] as const) {
    const out = validateJobInput({ sessionId: "s", name: "j", prompt: "p", cadenceSecs: 60, threadMode: mode });
    assert.equal((out as { threadMode: string }).threadMode, mode);
  }
});

test("same-session recurring receipts explain that they open the existing conversation", () => {
  const receipt = recurringJobReceipt({
    jobId: row.id,
    jobName: row.name,
    sessionId: row.session_id,
    threadMode: row.thread_mode,
    error: null,
  });
  assert.equal(receipt.kind, "job.complete");
  assert.equal(receipt.sessionId, "session-existing");
  assert.equal(receipt.href, "/?session=session-existing");
  assert.match(receipt.body, /existing conversation/);
});

test("new-session recurring receipts open the new target conversation", () => {
  const receipt = recurringJobReceipt({ jobId: row.id, jobName: row.name, sourceSessionId: row.session_id, sessionId: "session-new", threadMode: "new_session_per_run", error: null });
  assert.equal(receipt.sessionId, "session-new");
  assert.equal(receipt.href, "/?session=session-new");
  assert.match(receipt.body, /new conversation/);
});

test("recurring job receipt dedupe is per run destination, not per job forever", () => {
  const first = recurringJobReceipt({ jobId: row.id, jobName: row.name, sessionId: row.session_id, threadMode: "same_session", ranAt: new Date("2026-01-01T00:00:00.000Z"), error: "first failure" });
  const second = recurringJobReceipt({ jobId: row.id, jobName: row.name, sessionId: row.session_id, threadMode: "same_session", ranAt: new Date("2026-01-01T01:00:00.000Z"), error: "second failure" });
  assert.notEqual(first.dedupeKey, second.dedupeKey);
});

test("same-session target resolver reuses the source conversation", async () => {
  const env = { DB: { prepare() { throw new Error("same-session must not create a session"); } } } as unknown as Env;
  assert.deepEqual(await resolveRecurringJobTargetSession(env, row, new Date("2026-01-01T00:00:00.000Z")), {
    targetSessionId: "session-existing",
    sourceSessionId: "session-existing",
    threadMode: "same_session",
    created: false,
  });
});

test("new-session target resolver creates a fresh owned conversation", async () => {
  const inserts: unknown[][] = [];
  const env = { DB: { prepare(sql: string) { return { bind(...values: unknown[]) { inserts.push([sql, ...values]); return { async run() { return {}; } }; } }; } } } as unknown as Env;
  const target = await resolveRecurringJobTargetSession(env, { ...row, thread_mode: "new_session_per_run" }, new Date("2026-01-01T00:00:00.000Z"));
  assert.equal(target.sourceSessionId, "session-existing");
  assert.equal(target.threadMode, "new_session_per_run");
  assert.equal(target.created, true);
  assert.notEqual(target.targetSessionId, "session-existing");
  assert.equal(inserts.length, 1);
  assert.match(String(inserts[0][0]), /INSERT INTO sessions/);
  assert.equal(inserts[0][2], "Morning check · Jan 1, 12:00 AM UTC");
  assert.equal(inserts[0][3], "owner@example.com");
});

test("an unknown persisted thread_mode fails closed (never mints a new session)", async () => {
  let prepared = 0;
  const env = { DB: { prepare() { prepared++; throw new Error("must not touch DB"); } } } as unknown as Env;
  await assert.rejects(
    resolveRecurringJobTargetSession(env, { ...row, thread_mode: "bogus" as never }, new Date("2026-01-01T00:00:00.000Z")),
    /invalid recurring job thread mode: bogus/,
  );
  assert.equal(prepared, 0, "a bad mode must not INSERT a session");
});

test("recurring next-run math is independent of conversation threading mode", () => {
  assert.equal(computeNextRun(new Date("2026-01-01T00:00:00.000Z"), 3600), "2026-01-01T01:00:00.000Z");
});
