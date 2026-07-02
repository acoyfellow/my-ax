import assert from "node:assert/strict";
import test from "node:test";
import { completeRecurringJobRun } from "./recurring-job-run";
import type { Env } from "./types";

function envMock() {
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
