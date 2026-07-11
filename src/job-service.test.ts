import assert from "node:assert/strict";
import test from "node:test";
import { JobService, JobServiceError } from "./job-service";
import { requireScheduleId, type JobRow } from "./jobs";

test("native recurring schedules must return a durable id", () => {
  assert.throws(() => requireScheduleId({}), /did not return an id/);
  assert.equal(requireScheduleId({ id: "schedule-1" }), "schedule-1");
});

const row: JobRow = {
  id: "job-1", owner_email: "owner@example.com", session_id: "session-1", thread_mode: "same_session",
  name: "proof", prompt: "run", cadence_secs: 60, status: "active",
  next_run_at: "2026-01-01T00:01:00.000Z", last_run_at: null,
  last_error: null, schedule_id: "schedule-1", created_at: "now", updated_at: "now",
};

function fakeEnv(jobExists = true, sessionExists = true) {
  const events: Array<{ id: string; ok: number; detail_json: string; idempotency_key: string | null }> = [];
  const evidence: Array<{ action: string; ok: number; detail: any }> = [];
  const mutableRow = { ...row };
  const DB = {
    prepare(sql: string) {
      let values: unknown[] = [];
      return {
        bind(...next: unknown[]) { values = next; return this; },
        async first() {
          if (sql.includes("FROM jobs WHERE id")) return jobExists && values[0] === row.id && values[1] === row.owner_email ? { ...mutableRow } : null;
          if (sql.includes("FROM sessions")) return sessionExists ? { id: values[0] } : null;
          if (sql.includes("FROM job_events")) {
            const found = events.find((event) => event.idempotency_key === values[2]);
            return found ? { id: found.id, ok: found.ok, detail_json: found.detail_json } : null;
          }
          return null;
        },
        async all() {
          if (sql.includes("FROM job_events")) return { results: events.filter(() => values[1] === row.owner_email).map((event) => ({ ...event, job_id: row.id, action: "delete", created_at: "now" })) };
          return { results: [] };
        },
        async run() {
          if (sql.startsWith("INSERT INTO job_events") && sql.includes("idempotency_key")) {
            const key = String(values[4]);
            if (events.some((event) => event.idempotency_key === key)) throw new Error("unique");
            events.push({ id: String(values[0]), ok: 0, detail_json: String(values[3]), idempotency_key: key });
          } else if (sql.startsWith("INSERT INTO job_events")) {
            evidence.push({ action: String(values[3]), ok: Number(values[4]), detail: JSON.parse(String(values[5])) });
          } else if (sql.includes("last_error=?")) {
            Object.assign(mutableRow, { last_error: String(values[0]) });
          } else if (sql.startsWith("UPDATE job_events SET ok=0")) {
            const event = events.find((item) => item.id === values[1]);
            if (event) { event.ok = 0; event.detail_json = String(values[0]); }
          } else if (sql.startsWith("UPDATE job_events")) {
            const event = events.find((item) => item.id === values[2]);
            if (event) { event.ok = Number(values[0]); event.detail_json = String(values[1]); }
          } else if (sql.startsWith("UPDATE jobs SET session_id")) {
            Object.assign(mutableRow, { session_id: values[0], thread_mode: values[1], name: values[2], prompt: values[3], cadence_secs: values[4], next_run_at: values[5], schedule_id: values[6] });
          }
          return { success: true, meta: { changes: 1 } };
        },
      };
    },
  };
  return { env: { DB } as any, events, evidence, mutableRow };
}

test("idempotent run reserves its key before dispatch and replays the result", async () => {
  const { env, events } = fakeEnv();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let dispatches = 0;
  const runtime = {
    schedule: async () => "schedule",
    cancel: async () => undefined,
    run: async () => { dispatches++; await gate; return { ok: true, next_run_at: "next" }; },
  } as any;
  const service = new JobService(env, "OWNER@example.com", () => new Date("2026-01-01T00:00:00Z"), runtime);

  const first = service.run(row.id, "same-key");
  await new Promise((resolve) => setTimeout(resolve, 0));
  await assert.rejects(() => service.run(row.id, "same-key"), (error: unknown) => error instanceof JobServiceError && error.code === "Conflict");
  release();
  assert.deepEqual(await first, { ok: true, next_run_at: "next" });
  assert.deepEqual(await service.run(row.id, "same-key"), { ok: true, next_run_at: "next" });
  assert.equal(dispatches, 1);
  assert.equal(events.length, 1);
});

test("expired run lease is reclaimed while a fresh lease remains in progress", async () => {
  const now = new Date("2026-01-01T00:10:00Z");
  const { env, events } = fakeEnv();
  events.push({ id: "expired", ok: 0, detail_json: JSON.stringify({ pending: true, leaseExpiresAt: "2026-01-01T00:09:00Z" }), idempotency_key: "expired" });
  events.push({ id: "fresh", ok: 0, detail_json: JSON.stringify({ pending: true, leaseExpiresAt: "2026-01-01T00:11:00Z" }), idempotency_key: "fresh" });
  let dispatches = 0;
  const runtime = { schedule: async () => "schedule", cancel: async () => undefined, run: async () => { dispatches++; return { ok: true, next_run_at: "next" }; } } as any;
  const service = new JobService(env, row.owner_email, () => now, runtime);

  assert.deepEqual(await service.run(row.id, "expired"), { ok: true, next_run_at: "next" });
  await assert.rejects(() => service.run(row.id, "fresh"), (error: unknown) => error instanceof JobServiceError && error.code === "Conflict");
  assert.equal(dispatches, 1);
  assert.equal(events.length, 2);
});

test("completed and failed idempotent runs replay their authoritative outcomes", async () => {
  const { env, events } = fakeEnv();
  events.push({ id: "done", ok: 1, detail_json: JSON.stringify({ ok: true, next_run_at: "stored" }), idempotency_key: "done" });
  events.push({ id: "failed", ok: 0, detail_json: JSON.stringify({ ok: false, error: "stored failure" }), idempotency_key: "failed" });
  const runtime = { schedule: async () => "schedule", cancel: async () => undefined, run: async () => { throw new Error("must not dispatch"); } } as any;
  const service = new JobService(env, row.owner_email, () => new Date("2026-01-01T00:00:00Z"), runtime);

  assert.deepEqual(await service.run(row.id, "done"), { ok: true, next_run_at: "stored" });
  await assert.rejects(() => service.run(row.id, "failed"), (error: unknown) => error instanceof JobServiceError && error.code === "DispatchFailed" && error.message === "stored failure");
});

test("update retains replacement when retiring the old schedule fails", async () => {
  const { env, evidence, mutableRow } = fakeEnv();
  const cancelled: string[] = [];
  const runtime = {
    schedule: async () => "replacement",
    cancel: async (_env: unknown, job: JobRow) => { cancelled.push(job.schedule_id!); if (job.schedule_id === "schedule-1") throw new Error("timeout after cancel"); },
    run: async () => ({ ok: true }),
  } as any;
  const service = new JobService(env, row.owner_email, () => new Date("2026-01-01T00:00:00Z"), runtime);

  const updated = await service.update(row.id, { prompt: "updated" });
  assert.equal(updated.status, "active");
  assert.equal(updated.schedule_id, "replacement");
  assert.match(String(mutableRow.last_error), /orphaned/);
  assert.deepEqual(cancelled, ["schedule-1", "schedule-1"]);
  assert.equal(cancelled.includes("replacement"), false);
  assert.deepEqual(evidence[0], { action: "update", ok: 1, detail: { replacement: "replacement", orphanedOldScheduleId: "schedule-1", oldCancelError: "Error: timeout after cancel" } });
});

test("update to Specific thread persists the new target session id + mode", async () => {
  const { env, mutableRow } = fakeEnv();
  const runtime = { schedule: async () => "replacement", cancel: async () => undefined, run: async () => ({ ok: true }) } as any;
  const service = new JobService(env, row.owner_email, () => new Date("2026-01-01T00:00:00Z"), runtime);
  const updated = await service.update(row.id, { threadMode: "specific_session", sessionId: "session-chosen" });
  assert.equal(updated.thread_mode, "specific_session");
  assert.equal(mutableRow.session_id, "session-chosen");
});

test("Specific thread with an unowned/unknown id is rejected NotFound (no silent fallback)", async () => {
  const { env } = fakeEnv(true, /* sessionExists */ false);
  const runtime = { schedule: async () => "s", cancel: async () => undefined, run: async () => ({ ok: true }) } as any;
  const service = new JobService(env, row.owner_email, () => new Date("2026-01-01T00:00:00Z"), runtime);
  await assert.rejects(
    () => service.update(row.id, { threadMode: "specific_session", sessionId: "not-mine" }),
    (e: unknown) => e instanceof JobServiceError && e.code === "NotFound",
  );
});

test("deleted job history remains available through owner-scoped evidence", async () => {
  const { env, events } = fakeEnv(false);
  events.push({ id: "event-1", ok: 1, detail_json: "{}", idempotency_key: null });
  const service = new JobService(env, row.owner_email);
  const history = await service.history(row.id);
  assert.equal(history.length, 1);
  assert.equal(history[0].action, "delete");
});
