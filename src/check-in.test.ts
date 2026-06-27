import assert from "node:assert/strict";
import test from "node:test";
import { composeOwnerCheckIn } from "./check-in";

const job = { id: "job-1", name: "Digest", status: "active", next_run_at: "2026-06-25", last_error: null };
const run = { id: "run-1", title: "Ship", task_summary: "Ship it", status: "running", updated_at: "2026-06-24" };

test("check-in prioritizes unread owner attention", () => {
  const result = composeOwnerCheckIn({
    attention: [{ id: "a", title: "Choose", body: "Pick one", href: "/api/decisions/a", created_at: "2026-06-24" }],
    jobs: [job],
    runs: [run],
  });
  assert.equal(result.summary, "1 item needs your attention; 2 active.");
  assert.equal(result.needsOwner[0].id, "a");
  assert.deepEqual(result.suggestedSteers, [{ label: "Review attention", href: "/api/decisions/a" }]);
});

test("check-in separates completed receipts from running work", () => {
  const completed = { ...run, id: "run-2", status: "completed" };
  const result = composeOwnerCheckIn({ attention: [], jobs: [], runs: [completed] });
  assert.equal(result.summary, "0 active; 1 recently completed.");
  assert.equal(result.completed[0].id, "run-2");
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.running, { jobs: [], runs: [] });
  assert.equal(result.suggestedSteers[0].label, "Start a conversation");
});

test("check-in surfaces failed terminal runs before ordinary active work", () => {
  const failed = { ...run, id: "run-failed", status: "failed" };
  const result = composeOwnerCheckIn({ attention: [], jobs: [job], runs: [failed, run] });
  assert.equal(result.summary, "1 failed run needs review; 2 active.");
  assert.equal(result.failed[0].id, "run-failed");
  assert.equal(result.running.runs[0].id, "run-1");
  assert.deepEqual(result.suggestedSteers, [{ label: "Review failed work", href: "/api/runs/run-failed" }]);
});

test("unread attention still outranks failed run steering", () => {
  const failed = { ...run, id: "run-failed", status: "failed" };
  const result = composeOwnerCheckIn({
    attention: [{ id: "a", title: "Choose", body: "Pick one", href: "/api/decisions/a", created_at: "2026-06-24" }],
    jobs: [],
    runs: [failed],
  });
  assert.equal(result.summary, "1 item needs your attention; 0 active.");
  assert.equal(result.failed[0].id, "run-failed");
  assert.deepEqual(result.suggestedSteers, [{ label: "Review attention", href: "/api/decisions/a" }]);
});
