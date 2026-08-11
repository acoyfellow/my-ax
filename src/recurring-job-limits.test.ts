import { describe, expect, it } from "vitest";
import { claimRecurringJobRun, remainingRecurringJobRuns, type JobStatus } from "./jobs";
import { recurringJobReceipt } from "./recurring-job-receipt";
import type { Env } from "./types";

type PersistedJob = {
  max_runs: number | null;
  run_count: number;
  status: JobStatus;
  schedule_id: string | null;
};

function jobStore(job: PersistedJob) {
  const queries: string[] = [];
  const env = {
    DB: {
      prepare(sql: string) {
        queries.push(sql);
        return {
          bind(..._values: unknown[]) {
            return {
              async first<T>() {
                if (!sql.includes("UPDATE jobs")) return null;
                if (job.status !== "active" || (job.max_runs !== null && job.run_count >= job.max_runs)) return null;
                job.run_count += 1;
                if (job.max_runs !== null && job.run_count >= job.max_runs) {
                  job.status = "exhausted";
                  job.schedule_id = null;
                }
                return { max_runs: job.max_runs, run_count: job.run_count, status: job.status } as T;
              },
            };
          },
        };
      },
    },
  } as unknown as Env;
  return { env, job, queries };
}

describe("bounded recurring jobs", () => {
  it("runs once exactly once and exhausts", async () => {
    const store = jobStore({ max_runs: 1, run_count: 0, status: "active", schedule_id: "schedule-1" });

    expect(await claimRecurringJobRun(store.env, "job-1", "OWNER@example.com")).toEqual({ max_runs: 1, run_count: 1, status: "exhausted" });
    expect(await claimRecurringJobRun(store.env, "job-1", "owner@example.com")).toBeNull();
    expect(store.job).toEqual({ max_runs: 1, run_count: 1, status: "exhausted", schedule_id: null });
    expect(store.queries[0]).toContain("run_count < max_runs");
    expect(store.queries[0]).toContain("schedule_id = CASE");
  });

  it("runs a capped job exactly N times without an N plus one dispatch", async () => {
    const store = jobStore({ max_runs: 3, run_count: 0, status: "active", schedule_id: "schedule-3" });

    expect((await claimRecurringJobRun(store.env, "job-3", "owner@example.com"))?.run_count).toBe(1);
    expect((await claimRecurringJobRun(store.env, "job-3", "owner@example.com"))?.run_count).toBe(2);
    expect(await claimRecurringJobRun(store.env, "job-3", "owner@example.com")).toEqual({ max_runs: 3, run_count: 3, status: "exhausted" });
    expect(await claimRecurringJobRun(store.env, "job-3", "owner@example.com")).toBeNull();
    expect(store.job.run_count).toBe(3);
  });

  it("does not auto-exhaust an unlimited job", async () => {
    const store = jobStore({ max_runs: null, run_count: 0, status: "active", schedule_id: "schedule-unlimited" });

    for (let index = 0; index < 10; index += 1) await claimRecurringJobRun(store.env, "job-unlimited", "owner@example.com");

    expect(store.job).toEqual({ max_runs: null, run_count: 10, status: "active", schedule_id: "schedule-unlimited" });
    expect(remainingRecurringJobRuns(store.job)).toBeNull();
  });

  it("reads persisted consumed runs after restart and reports the exact remaining count", async () => {
    const firstStore = jobStore({ max_runs: 4, run_count: 1, status: "active", schedule_id: "schedule-4" });
    const claimed = await claimRecurringJobRun(firstStore.env, "job-4", "owner@example.com");
    const restartedStore = jobStore({ ...firstStore.job });
    const resumed = await claimRecurringJobRun(restartedStore.env, "job-4", "owner@example.com");
    const receipt = recurringJobReceipt({
      jobId: "job-4",
      jobName: "Bounded proof",
      sessionId: "session-4",
      ranAt: new Date("2026-08-11T00:00:00.000Z"),
      runCount: resumed?.run_count,
      maxRuns: resumed?.max_runs,
    });

    expect(claimed).toEqual({ max_runs: 4, run_count: 2, status: "active" });
    expect(resumed).toEqual({ max_runs: 4, run_count: 3, status: "active" });
    expect(remainingRecurringJobRuns(restartedStore.job)).toBe(1);
    expect(receipt.title).toBe("Bounded proof run completed");
    expect(receipt.body).toContain("Run 3 of 4 completed. Runs remaining: 1.");
  });
});
