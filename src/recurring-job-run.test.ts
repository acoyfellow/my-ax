import assert from "node:assert/strict";
import test from "node:test";
import { completeRecurringJobRun, recurringSubmissionTerminalError, settleInspectedRecurringJobRun } from "./recurring-job-run";
import { recurringScheduleFireKey, recurringScheduleIdentity, type RecurringScheduleDispatchClaim } from "./jobs";
import type { Env } from "./types";

const scheduledAt = new Date("2026-06-24T12:00:00.000Z");
const claim: RecurringScheduleDispatchClaim = {
  jobId: "job-1",
  ownerEmail: "owner@example.com",
  sessionId: "session-1",
  scheduleId: recurringScheduleIdentity("native-current", "generation-current"),
  generation: "generation-current",
  scheduledAt: scheduledAt.toISOString(),
  fireKey: recurringScheduleFireKey("job-1", scheduledAt, "generation-current"),
  verifierHash: "a39c3b1f47c55e660677342bed9e472e0d7ff052c1f7826b73ca00d0086fcb65",
  submissionId: "24d377c3-9e9f-4e88-8e56-ac5b34fb7a01",
  targetSessionId: "session-1",
  receiptId: "a7d22e95-484a-4a48-a1c5-e0c7e0dfad54",
};

function envMock(batchResults: Array<{ success?: boolean; meta?: { changes?: number } }> = [
  { success: true, meta: { changes: 1 } },
  { success: true, meta: { changes: 1 } },
  { success: true, meta: { changes: 1 } },
]) {
  const calls: { sql: string; binds: unknown[] }[] = [];
  let batches = 0;
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind(...binds: unknown[]) {
            calls.push({ sql, binds });
            return {
              async run() { return { success: true, meta: { changes: 1 } }; },
              async first() { return sql.includes("SELECT name") ? { name: "Current job" } : null; },
            };
          },
        };
      },
      async batch() { batches++; return batchResults; },
    },
  } as unknown as Env;
  return { env, calls, batches: () => batches };
}

function input(overrides: Partial<Parameters<typeof completeRecurringJobRun>[1]> = {}) {
  return {
    jobId: claim.jobId,
    ownerEmail: claim.ownerEmail,
    sessionId: claim.targetSessionId,
    sourceSessionId: claim.sessionId,
    threadMode: "same_session" as const,
    ranAt: scheduledAt,
    nextRunAt: "2026-06-24T13:00:00.000Z",
    jobName: "Current job",
    claim,
    ...overrides,
  };
}

test("terminal persistence atomically progresses dispatched work, receipt, then terminal", async () => {
  const { env, calls } = envMock();
  assert.equal(await completeRecurringJobRun(env, input()), true);
  assert.equal(calls.filter((call) => call.sql.startsWith("UPDATE jobs SET")).length, 2);
  assert.ok(calls.some((call) => call.sql.includes("INSERT OR IGNORE INTO attention_items")));
  assert.ok(calls.every((call) => !call.binds.includes("generation-current")));
});

test("rejected and partial D1 batches are surfaced so the same submission can settle on a later interval", async () => {
  const partial = envMock([
    { success: true, meta: { changes: 1 } },
    { success: false, meta: { changes: 0 } },
    { success: true, meta: { changes: 0 } },
  ]);
  await assert.rejects(() => completeRecurringJobRun(partial.env, input()), /not confirmed/);
  const retry = envMock([
    { success: true, meta: { changes: 0 } },
    { success: true, meta: { changes: 1 } },
    { success: true, meta: { changes: 1 } },
  ]);
  assert.equal(await completeRecurringJobRun(retry.env, input()), true);
});

test("later authoritative terminal inspections settle once while nonterminal inspections do not write a receipt", async () => {
  for (const submission of [
    { status: "completed" as const },
    { status: "error" as const, error: "provider unavailable" },
    { status: "aborted" as const },
    { status: "skipped" as const },
  ]) {
    const probe = envMock();
    assert.equal(await settleInspectedRecurringJobRun(probe.env, { ...input(), submission }), "terminal");
    assert.equal(probe.batches(), 1);
  }
  for (const submission of [{ status: "pending" as const }, { status: "running" as const }]) {
    const probe = envMock();
    assert.equal(await settleInspectedRecurringJobRun(probe.env, { ...input(), submission }), "nonterminal");
    assert.equal(probe.batches(), 0);
  }
});

test("an invalid or forged claim cannot settle an owner fire", async () => {
  const { env, calls } = envMock();
  assert.equal(await completeRecurringJobRun(env, input({ claim: { ...claim, targetSessionId: "other-session" } })), false);
  assert.equal(calls.length, 0);
});

test("all Think terminal outcomes settle and unknown terminal values do not wedge", () => {
  assert.equal(recurringSubmissionTerminalError("completed"), null);
  assert.equal(recurringSubmissionTerminalError("error", "provider unavailable"), "provider unavailable");
  assert.equal(recurringSubmissionTerminalError("aborted"), "scheduled run aborted");
  assert.equal(recurringSubmissionTerminalError("skipped"), "scheduled run skipped");
  assert.equal(recurringSubmissionTerminalError("pending"), undefined);
  assert.equal(recurringSubmissionTerminalError("unexpected"), "scheduled run ended in an unexpected terminal state");
});
