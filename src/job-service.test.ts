import assert from "node:assert/strict";
import test from "node:test";
import { JobService, JobServiceError } from "./job-service";
import { requireScheduleId, type JobRow } from "./jobs";

test("native recurring schedules must return a durable id", () => {
  assert.throws(() => requireScheduleId({}), /did not return an id/);
  assert.equal(requireScheduleId({ id: "schedule-1" }), "schedule-1");
});

const row: JobRow = {
  id: "job-1", owner_email: "owner@example.com", session_id: "session-1",
  name: "proof", prompt: "run", cadence_secs: 60, status: "active",
  next_run_at: "2026-01-01T00:01:00.000Z", last_run_at: null,
  last_error: null, schedule_id: "schedule-1", created_at: "now", updated_at: "now",
};

function fakeEnv(jobExists = true) {
  const events: Array<{ id: string; ok: number; detail_json: string; idempotency_key: string | null }> = [];
  const DB = {
    prepare(sql: string) {
      let values: unknown[] = [];
      return {
        bind(...next: unknown[]) { values = next; return this; },
        async first() {
          if (sql.includes("FROM jobs WHERE id")) return jobExists && values[0] === row.id && values[1] === row.owner_email ? row : null;
          if (sql.includes("FROM job_events")) {
            const found = events.find((event) => event.idempotency_key === values[2]);
            return found ? { ok: found.ok, detail_json: found.detail_json } : null;
          }
          return null;
        },
        async all() {
          if (sql.includes("FROM job_events")) return { results: events.filter(() => values[1] === row.owner_email).map((event) => ({ ...event, job_id: row.id, action: "delete", created_at: "now" })) };
          return { results: [] };
        },
        async run() {
          if (sql.startsWith("INSERT INTO job_events")) {
            const key = String(values[4]);
            if (events.some((event) => event.idempotency_key === key)) throw new Error("unique");
            events.push({ id: String(values[0]), ok: 0, detail_json: String(values[3]), idempotency_key: key });
          } else if (sql.startsWith("UPDATE job_events")) {
            const event = events.find((item) => item.id === values[2]);
            if (event) { event.ok = Number(values[0]); event.detail_json = String(values[1]); }
          }
          return { success: true, meta: { changes: 1 } };
        },
      };
    },
  };
  return { env: { DB } as any, events };
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

test("deleted job history remains available through owner-scoped evidence", async () => {
  const { env, events } = fakeEnv(false);
  events.push({ id: "event-1", ok: 1, detail_json: "{}", idempotency_key: null });
  const service = new JobService(env, row.owner_email);
  const history = await service.history(row.id);
  assert.equal(history.length, 1);
  assert.equal(history[0].action, "delete");
});
