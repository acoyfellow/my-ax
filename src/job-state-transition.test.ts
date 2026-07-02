import assert from "node:assert/strict";
import test from "node:test";
import { transitionJobPaused, type JobStateTransitionDeps } from "./job-state-transition";
import type { JobRow } from "./jobs";

const pausedRow = (): JobRow => ({
  id: "job", owner_email: "owner@example.com", session_id: "session", thread_mode: "same_session", name: "job", prompt: "go",
  cadence_secs: 60, status: "paused", next_run_at: "old", last_run_at: null, last_error: null,
  schedule_id: null, created_at: "now", updated_at: "now",
});

test("resume is idempotent and the resulting schedule is cancelled once on pause", async () => {
  let schedules = 0;
  const cancelled: Array<string | null> = [];
  const deps: JobStateTransitionDeps = {
    schedule: async () => { schedules++; return "schedule-1"; },
    cancel: async (row) => { cancelled.push(row.schedule_id); },
    persist: async () => undefined,
    nextRun: () => "next",
  };

  const active = await transitionJobPaused(pausedRow(), false, deps);
  const resumedAgain = await transitionJobPaused(active, false, deps);
  const paused = await transitionJobPaused(resumedAgain, true, deps);

  assert.equal(schedules, 1);
  assert.equal(active.schedule_id, "schedule-1");
  assert.equal(resumedAgain.schedule_id, "schedule-1");
  assert.deepEqual(cancelled, ["schedule-1"]);
  assert.equal(paused.schedule_id, null);
});

test("resume cancels its new schedule when persistence fails", async () => {
  const cancelled: Array<string | null> = [];
  const deps: JobStateTransitionDeps = {
    schedule: async () => "schedule-new",
    cancel: async (row) => { cancelled.push(row.schedule_id); },
    persist: async () => { throw new Error("database unavailable"); },
    nextRun: () => "next",
  };

  await assert.rejects(transitionJobPaused(pausedRow(), false, deps), /database unavailable/);
  assert.deepEqual(cancelled, ["schedule-new"]);
});
