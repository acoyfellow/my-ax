import assert from "node:assert/strict";
import test from "node:test";
import { completeRecurringJobRun } from "./recurring-job-run";
import type { Env } from "./types";

function envMock(opts: { jobUpdateChanges?: number } = {}) {
  const jobUpdateChanges = opts.jobUpdateChanges ?? 1;
  const calls: { sql: string; binds: unknown[] }[] = [];
  const inserted: { title: string; body: string; href: string; kind: string }[] = [];
  const env = {
    BRIDGE_BASE_URL: "https://my.ax.test",
    DB: {
      prepare(sql: string) {
        return {
          bind(...binds: unknown[]) {
            calls.push({ sql, binds });
            return {
              async run() {
                if (sql.includes("INSERT INTO attention_items")) {
                  inserted.push({ title: String(binds[4]), body: String(binds[5]), href: String(binds[6]), kind: String(binds[3]) });
                }
                if (sql.includes("UPDATE jobs SET")) return { meta: { changes: jobUpdateChanges } };
                return {};
              },
              async first() {
                if (sql.includes("SELECT name FROM jobs")) return { name: "Fallback job" };
                if (sql.includes("COUNT(*) AS count")) return { count: inserted.length };
                return null;
              },
              async all() { return { results: [] }; },
            };
          },
        };
      },
    },
  } as unknown as Env;
  return { env, calls, inserted };
}

test("completeRecurringJobRun records terminal state and same-session receipt path", async () => {
  const { env, calls, inserted } = envMock();
  await completeRecurringJobRun(env, {
    jobId: "job-1",
    ownerEmail: "Owner@Example.COM",
    sessionId: "session 1",
    sourceSessionId: "session 1",
    threadMode: "same_session",
    ranAt: new Date("2026-06-24T12:00:00.000Z"),
    nextRunAt: "2026-06-24T13:00:00.000Z",
    jobName: "Daily proof",
  });
  assert.ok(calls.some((call) => call.sql.includes("UPDATE jobs SET next_run_at") && call.binds.includes("owner@example.com")));
  assert.deepEqual(inserted, [{
    kind: "job.complete",
    title: "Daily proof completed",
    body: "Completed successfully in the existing conversation. Next action: open it to review the result.",
    href: "/?session=session%201",
  }]);
});

test("completeRecurringJobRun records terminal state and new-session receipt path", async () => {
  const { env, inserted } = envMock();
  await completeRecurringJobRun(env, {
    jobId: "job-1",
    ownerEmail: "Owner@Example.COM",
    sessionId: "session-new",
    sourceSessionId: "session-source",
    threadMode: "new_session_per_run",
    ranAt: new Date("2026-06-24T12:00:00.000Z"),
    nextRunAt: "2026-06-24T13:00:00.000Z",
    jobName: "Daily proof",
  });
  assert.equal(inserted[0]?.href, "/?session=session-new");
  assert.match(inserted[0]?.body ?? "", /new conversation/);
});

test("completeRecurringJobRun uses the explicit destination for failed scheduled runs", async () => {
  const { env, calls, inserted } = envMock();
  await completeRecurringJobRun(env, {
    jobId: "job-2",
    ownerEmail: "owner@example.com",
    sessionId: "session-2",
    threadMode: "same_session",
    ranAt: new Date("2026-06-24T12:00:00.000Z"),
    error: "failed\nwith detail",
  });
  assert.ok(calls.some((call) => call.sql.includes("UPDATE jobs SET last_run_at")));
  assert.equal(inserted[0]?.title, "Fallback job failed");
  assert.match(inserted[0]?.body ?? "", /failed with detail/);
  assert.match(inserted[0]?.body ?? "", /Next action: open the existing conversation and retry or update the job\./);
});

test("completeRecurringJobRun suppresses the failure push for a transient gateway rate limit", async () => {
  const { env, calls, inserted } = envMock();
  await completeRecurringJobRun(env, {
    jobId: "job-rl",
    ownerEmail: "owner@example.com",
    sessionId: "session-rl",
    threadMode: "same_session",
    ranAt: new Date("2026-06-24T12:00:00.000Z"),
    error: "3021: rate limiting: inference request per min rate reached",
  });
  // last_error is still persisted for diagnostics.
  assert.ok(calls.some((call) => call.sql.includes("UPDATE jobs SET last_run_at") && call.binds.some((b) => String(b).includes("3021"))));
  // But the owner sees a single coalesced heads-up, NOT a "<job> failed" receipt.
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0]?.kind, "session.update");
  assert.match(inserted[0]?.title ?? "", /rate limit/i);
  assert.doesNotMatch(inserted[0]?.body ?? "", /3021/);
  assert.doesNotMatch(inserted[0]?.title ?? "", /failed/i);
});

test("a non-rate-limit error still pushes a normal failure receipt", async () => {
  const { env, inserted } = envMock();
  await completeRecurringJobRun(env, {
    jobId: "job-err",
    ownerEmail: "owner@example.com",
    sessionId: "session-err",
    threadMode: "same_session",
    ranAt: new Date("2026-06-24T12:00:00.000Z"),
    error: "TypeError: cannot read property of undefined",
  });
  assert.equal(inserted[0]?.kind, "job.complete");
  assert.match(inserted[0]?.title ?? "", /failed/i);
});

test("completeRecurringJobRun emits nothing when the owner-qualified UPDATE matched no row", async () => {
  const { env, calls, inserted } = envMock({ jobUpdateChanges: 0 });
  await completeRecurringJobRun(env, {
    jobId: "job-1",
    ownerEmail: "bob@example.com",
    sessionId: "session-alice",
    sourceSessionId: "session-alice",
    threadMode: "same_session",
    ranAt: new Date("2026-06-24T12:00:00.000Z"),
    nextRunAt: "2026-06-24T13:00:00.000Z",
    jobName: "Alice's payroll job",
  });
  assert.ok(calls.some((call) => call.sql.includes("UPDATE jobs SET")), "the UPDATE is still attempted");
  assert.deepEqual(inserted, [], "no receipt/notification for an unpersisted terminal run");
});
