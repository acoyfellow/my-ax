import assert from "node:assert/strict";
import test from "node:test";
import { claimRecurringScheduleDispatch, currentRecurringSchedulePayload, findVersionedRecurringSchedule, isAuthoritativeLegacyRecurringSchedule, recoveredRecurringScheduleDispatch, recurringScheduleFence, recurringScheduleFireKey, recurringScheduleIdentity, recurringScheduleRunMessageId, validateCurrentRecurringSchedule, type JobRow, type NativeRecurringSchedule, type RecurringJobState, type RecurringSchedulePayload } from "./jobs";
import type { Env } from "./types";

const scheduledAt = new Date("2026-08-06T15:00:00.000Z");
const payload: RecurringSchedulePayload = {
  version: 1,
  jobId: "9f1bba8e-0dc1-4d5c-bfa5-4af7d50f128b",
  ownerEmail: "owner@example.com",
  sessionId: "session-current",
  prompt: "Check the current deployment.",
  generation: "generation-current",
};

function row(overrides: Partial<RecurringJobState> = {}): RecurringJobState {
  return {
    id: payload.jobId,
    owner_email: payload.ownerEmail,
    session_id: payload.sessionId,
    thread_mode: "same_session",
    name: "Deployment check",
    prompt: payload.prompt,
    cadence_secs: 300,
    status: "active",
    next_run_at: scheduledAt.toISOString(),
    last_run_at: null,
    last_error: null,
    schedule_id: recurringScheduleIdentity("native-current", payload.generation),
    created_at: "2026-08-06T14:00:00.000Z",
    updated_at: "2026-08-06T14:00:00.000Z",
    state_version: 0,
    recurring_fire_key: null,
    recurring_fire_verifier_hash: null,
    recurring_fire_state: null,
    recurring_fire_scheduled_at: null,
    recurring_submission_id: null,
    recurring_fire_target_session_id: null,
    recurring_receipt_id: null,
    ...overrides,
  };
}

function schedule(overrides: Partial<NativeRecurringSchedule> = {}): NativeRecurringSchedule {
  return { id: "native-current", callback: "runRecurringPrompt", payload, type: "interval", intervalSeconds: 300, ...overrides };
}

async function validate(overrides: { value?: unknown; job?: JobRow | null; schedules?: unknown } = {}) {
  return validateCurrentRecurringSchedule({
    row: overrides.job === undefined ? row() : overrides.job,
    payload: overrides.value === undefined ? payload : overrides.value,
    sessionId: payload.sessionId,
    listSchedules: async () => overrides.schedules ?? [schedule()],
  });
}

test("current schedules require every authoritative native and D1 field", async () => {
  assert.deepEqual(await validate(), { ok: true });
  assert.deepEqual(await validate({ value: { ...payload, generation: "other" } }), { ok: false, reason: "generation_mismatch" });
  assert.deepEqual(await validate({ schedules: [schedule({ id: "other" })] }), { ok: false, reason: "schedule_missing" });
  assert.deepEqual(await validate({ schedules: Array.from({ length: 101 }, () => schedule()) }), { ok: false, reason: "schedule_list_failed" });
  assert.deepEqual(await validate({ job: row({ schedule_id: "legacy-native" }) }), { ok: false, reason: "legacy_schedule_identity" });
});

function claimEnv(changes: number) {
  const calls: { sql: string; binds: unknown[] }[] = [];
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind(...binds: unknown[]) {
            calls.push({ sql, binds });
            return { async run() { return { meta: { changes } }; } };
          },
        };
      },
    },
  } as unknown as Env;
  return { env, calls };
}

test("a claim stores an opaque public id separately from its server verifier", async () => {
  const fence = recurringScheduleFence(row(), payload.generation);
  assert.ok(fence);
  const { env, calls } = claimEnv(1);
  const claim = await claimRecurringScheduleDispatch(env, fence, scheduledAt, payload.sessionId);
  assert.ok(claim);
  assert.equal(claim.fireKey, recurringScheduleFireKey(payload.jobId, scheduledAt, payload.generation));
  assert.equal(recurringScheduleRunMessageId(claim), claim.submissionId);
  assert.notEqual(claim.submissionId, claim.fireKey);
  assert.ok(!claim.submissionId.includes(payload.jobId));
  assert.ok(!claim.submissionId.includes(payload.generation));
  assert.match(calls[0]?.sql ?? "", /recurring_fire_verifier_hash/);
  assert.equal(calls[0]?.binds.includes(claim.submissionId), true);
  assert.equal(calls[0]?.binds.includes(claim.fireKey), true);
});

test("later intervals recover an admitted fire with its same opaque id rather than claim duplicate work", () => {
  const fence = recurringScheduleFence(row(), payload.generation);
  assert.ok(fence);
  const fireKey = recurringScheduleFireKey(payload.jobId, scheduledAt, payload.generation);
  const recovered = recoveredRecurringScheduleDispatch(row({
    recurring_fire_state: "dispatched",
    recurring_fire_key: fireKey,
    recurring_fire_verifier_hash: "a39c3b1f47c55e660677342bed9e472e0d7ff052c1f7826b73ca00d0086fcb65",
    recurring_fire_scheduled_at: scheduledAt.toISOString(),
    recurring_submission_id: "5f019c09-8b2a-4935-a50b-54b5d5322532",
    recurring_fire_target_session_id: payload.sessionId,
    recurring_receipt_id: "d00f8bfd-99b2-4c4a-8da9-2bb0bb75c07c",
  }), fence, scheduledAt);
  assert.ok(recovered);
  assert.equal(recovered.submissionId, "5f019c09-8b2a-4935-a50b-54b5d5322532");
  assert.equal(recovered.fireKey, fireKey);
  assert.equal(recoveredRecurringScheduleDispatch(row({ recurring_fire_state: "dispatched", recurring_fire_key: fireKey }), fence, scheduledAt), null);
});

test("legacy reconciliation only recognizes the precise deployed legacy native row and a bounded current replacement", () => {
  const legacy = { jobId: payload.jobId, ownerEmail: payload.ownerEmail, prompt: payload.prompt };
  const legacyRow = row({ schedule_id: "legacy-native" });
  const legacySchedule: NativeRecurringSchedule = { id: "legacy-native", callback: "runRecurringPrompt", payload: legacy, type: "interval", intervalSeconds: 300 };
  assert.equal(isAuthoritativeLegacyRecurringSchedule(legacySchedule, legacyRow, legacy), true);
  assert.equal(isAuthoritativeLegacyRecurringSchedule({ ...legacySchedule, payload: { ...legacy, prompt: "forged" } }, legacyRow, legacy), false);
  assert.equal(isAuthoritativeLegacyRecurringSchedule({ ...legacySchedule, intervalSeconds: 301 }, legacyRow, legacy), false);
  const replacement = findVersionedRecurringSchedule([schedule()], row());
  assert.equal(replacement?.schedule.id, "native-current");
  assert.equal(currentRecurringSchedulePayload(row(), payload.generation).sessionId, payload.sessionId);
});
