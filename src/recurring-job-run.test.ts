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

test("completeRecurringJobRun is the shared terminal state and owner receipt path", async () => {
  const { env, calls, inserted } = envMock();
  await completeRecurringJobRun(env, {
    jobId: "job-1",
    ownerEmail: "Owner@Example.COM",
    sessionId: "session 1",
    ranAt: new Date("2026-06-24T12:00:00.000Z"),
    nextRunAt: "2026-06-24T13:00:00.000Z",
    jobName: "Daily proof",
  });
  assert.ok(calls.some((call) => call.sql.includes("UPDATE jobs SET next_run_at") && call.binds.includes("owner@example.com")));
  assert.deepEqual(inserted, [{
    kind: "job.complete",
    title: "Daily proof completed",
    body: "Completed successfully. Next action: open the conversation to review the result.",
    href: "/?session=session%201",
  }]);
});

test("completeRecurringJobRun uses the same receipt path for failed scheduled runs", async () => {
  const { env, calls, inserted } = envMock();
  await completeRecurringJobRun(env, {
    jobId: "job-2",
    ownerEmail: "owner@example.com",
    sessionId: "session-2",
    ranAt: new Date("2026-06-24T12:00:00.000Z"),
    error: "failed\nwith detail",
  });
  assert.ok(calls.some((call) => call.sql.includes("UPDATE jobs SET last_run_at")));
  assert.equal(inserted[0]?.title, "Fallback job failed");
  assert.match(inserted[0]?.body ?? "", /failed with detail/);
  assert.match(inserted[0]?.body ?? "", /Next action: open the conversation and retry or update the job\./);
});
