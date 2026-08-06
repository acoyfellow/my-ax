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
  last_error: null, schedule_id: "schedule-1", created_at: "now", updated_at: "now", state_version: 0,
};

function fakeEnv(jobExists = true, sessionExists = true, cancellationParkingChanges: 0 | 1 | null = null) {
  const events: Array<{ id: string; ok: number; detail_json: string; idempotency_key: string | null }> = [];
  const evidence: Array<{ action: string; ok: number; detail: any }> = [];
  const cancellations: Array<{ id: string; job_id: string; owner_email: string; session_id: string; schedule_id: string; created_at: string }> = [];
  const mutableRow = { ...row };
  let exists = jobExists;
  const DB = {
    prepare(sql: string) {
      let values: unknown[] = [];
      return {
        bind(...next: unknown[]) { values = next; return this; },
        async first() {
          if (sql.includes("FROM jobs WHERE id")) return exists && values[0] === row.id && values[1] === row.owner_email ? { ...mutableRow } : null;
          if (sql.includes("FROM sessions")) return sessionExists ? { id: values[0] } : null;
          if (sql.includes("FROM job_events")) {
            const found = events.find((event) => event.idempotency_key === values[2]);
            return found ? { id: found.id, ok: found.ok, detail_json: found.detail_json } : null;
          }
          if (sql.includes("FROM recurring_schedule_cancellations")) {
            const found = cancellations.find((cancellation) => cancellation.owner_email === values[0] && cancellation.session_id === values[1] && cancellation.schedule_id === values[2]);
            return found ? { ...found } : null;
          }
          return null;
        },
        async all() {
          if (sql.includes("FROM job_events")) return { results: events.filter(() => values[1] === row.owner_email).map((event) => ({ ...event, job_id: row.id, action: "delete", created_at: "now" })) };
          if (sql.includes("FROM recurring_schedule_cancellations")) return { results: cancellations.filter((cancellation) => cancellation.job_id === values[0] && cancellation.owner_email === values[1]).map((cancellation) => ({ ...cancellation })) };
          return { results: [] };
        },
        async run() {
          let changes = 1;
          if (sql.startsWith("INSERT OR IGNORE INTO recurring_schedule_cancellations")) {
            const existing = cancellations.find((cancellation) => cancellation.owner_email === values[2] && cancellation.session_id === values[3] && cancellation.schedule_id === values[4]);
            if (existing || cancellationParkingChanges === 0) {
              changes = 0;
            } else {
              cancellations.push({ id: String(values[0]), job_id: String(values[1]), owner_email: String(values[2]), session_id: String(values[3]), schedule_id: String(values[4]), created_at: "now" });
            }
          } else if (sql.startsWith("DELETE FROM recurring_schedule_cancellations")) {
            const index = cancellations.findIndex((cancellation) => cancellation.id === values[0] && cancellation.owner_email === values[1]);
            changes = Number(index >= 0);
            if (index >= 0) cancellations.splice(index, 1);
          } else if (sql.startsWith("INSERT INTO job_events") && sql.includes("idempotency_key")) {
            const key = String(values[4]);
            if (events.some((event) => event.idempotency_key === key)) throw new Error("unique");
            events.push({ id: String(values[0]), ok: 0, detail_json: String(values[3]), idempotency_key: key });
          } else if (sql.startsWith("INSERT INTO job_events")) {
            evidence.push({ action: String(values[3]), ok: Number(values[4]), detail: JSON.parse(String(values[5])) });
          } else if (sql.includes("last_error=?") || sql.includes("last_error = ?")) {
            Object.assign(mutableRow, { last_error: String(values[0]) });
          } else if (sql.startsWith("UPDATE job_events SET ok=0")) {
            const event = events.find((item) => item.id === values[1]);
            if (event) { event.ok = 0; event.detail_json = String(values[0]); }
          } else if (sql.startsWith("UPDATE job_events")) {
            const event = events.find((item) => item.id === values[2]);
            if (event) { event.ok = Number(values[0]); event.detail_json = String(values[1]); }
          } else if (sql.startsWith("UPDATE jobs SET session_id")) {
            const expectedVersion = Number(values[9]);
            const expectedStatus = values[10];
            const expectedSchedule = values[11];
            changes = Number(exists && mutableRow.state_version === expectedVersion && mutableRow.status === expectedStatus && mutableRow.schedule_id === expectedSchedule);
            if (changes) Object.assign(mutableRow, { session_id: values[0], thread_mode: values[1], name: values[2], prompt: values[3], cadence_secs: values[4], next_run_at: values[5], schedule_id: values[6], state_version: mutableRow.state_version + 1 });
          } else if (sql.startsWith("UPDATE jobs SET status='active'")) {
            const expectedVersion = Number(values[4]);
            changes = Number(exists && mutableRow.status === "paused" && mutableRow.schedule_id === null && mutableRow.state_version === expectedVersion);
            if (changes) Object.assign(mutableRow, { status: "active", schedule_id: values[0], next_run_at: values[1], state_version: mutableRow.state_version + 1 });
          } else if (sql.startsWith("UPDATE jobs SET status='paused'")) {
            const expectedVersion = Number(values[2]);
            changes = Number(exists && mutableRow.status === "active" && mutableRow.schedule_id === values[3] && mutableRow.state_version === expectedVersion);
            if (changes) Object.assign(mutableRow, { status: "paused", schedule_id: null, state_version: mutableRow.state_version + 1 });
          } else if (sql.startsWith("DELETE FROM jobs WHERE id=?")) {
            const expectedVersion = Number(values[2]);
            changes = Number(exists && mutableRow.state_version === expectedVersion && mutableRow.status === values[3] && mutableRow.schedule_id === values[4]);
            if (changes) exists = false;
          }
          return { success: true, meta: { changes } };
        },
      };
    },
  };
  return { env: { DB } as any, events, evidence, cancellations, mutableRow };
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail("timed out waiting for test interleaving");
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
  assert.equal(updated.schedule_id, undefined);
  assert.equal(mutableRow.schedule_id, "replacement");
  assert.match(String(mutableRow.last_error), /cancellation pending/);
  assert.deepEqual(cancelled, ["schedule-1"]);
  assert.equal(cancelled.includes("replacement"), false);
  assert.deepEqual(evidence[0], { action: "update", ok: 1, detail: { replacementScheduled: true, oldScheduleCancellationPending: true } });
});

test("concurrent updates cancel the losing replacement schedule", async () => {
  const { env, mutableRow } = fakeEnv();
  const scheduled: string[] = [];
  const cancelled: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const runtime = {
    schedule: async () => {
      const scheduleId = `replacement-${scheduled.length + 1}`;
      scheduled.push(scheduleId);
      await gate;
      return scheduleId;
    },
    cancel: async (_env: unknown, job: JobRow) => { if (job.schedule_id) cancelled.push(job.schedule_id); },
    run: async () => ({ ok: true }),
  } as any;
  const service = new JobService(env, row.owner_email, () => new Date("2026-01-01T00:00:00Z"), runtime);
  const first = service.update(row.id, { prompt: "first" });
  const second = service.update(row.id, { prompt: "second" });
  await waitFor(() => scheduled.length === 2);
  release();
  const results = await Promise.allSettled([first, second]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && result.reason instanceof JobServiceError && result.reason.code === "Conflict").length, 1);
  const survivor = String(mutableRow.schedule_id);
  const loser = scheduled.find((scheduleId) => scheduleId !== survivor);
  assert.ok(loser);
  assert.ok(cancelled.includes(loser));
  assert.ok(cancelled.includes("schedule-1"));
  assert.equal(cancelled.includes(survivor), false);
});

test("an update racing a pause cancels its unpersisted replacement", async () => {
  const { env, mutableRow } = fakeEnv();
  const cancelled: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let scheduled = false;
  let pauseReachedCancellation = false;
  const runtime = {
    schedule: async () => { scheduled = true; await gate; return "replacement"; },
    cancel: async (_env: unknown, job: JobRow) => {
      if (job.schedule_id) cancelled.push(job.schedule_id);
      if (job.schedule_id === "schedule-1") pauseReachedCancellation = true;
    },
    run: async () => ({ ok: true }),
  } as any;
  const service = new JobService(env, row.owner_email, () => new Date("2026-01-01T00:00:00Z"), runtime);
  const update = service.update(row.id, { prompt: "updated" });
  await waitFor(() => scheduled);
  const pause = service.setPaused(row.id, true);
  await waitFor(() => pauseReachedCancellation);
  release();
  await pause;
  await assert.rejects(update, (error: unknown) => error instanceof JobServiceError && error.code === "Conflict");
  assert.equal(mutableRow.status, "paused");
  assert.equal(mutableRow.schedule_id, null);
  assert.deepEqual(cancelled.sort(), ["replacement", "schedule-1"]);
});

test("an update racing pause retains a failed losing replacement for a later retry", async () => {
  const { env, cancellations } = fakeEnv();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let scheduled = false;
  let pauseReachedCancellation = false;
  const runtime = {
    schedule: async () => { scheduled = true; await gate; return "replacement"; },
    cancel: async (_env: unknown, job: JobRow) => {
      if (job.schedule_id === "schedule-1") pauseReachedCancellation = true;
      if (job.schedule_id === "replacement") throw new Error("native cancellation unavailable");
    },
    run: async () => ({ ok: true }),
  } as any;
  const service = new JobService(env, row.owner_email, () => new Date("2026-01-01T00:00:00Z"), runtime);

  const update = service.update(row.id, { prompt: "updated" });
  await waitFor(() => scheduled);
  const pause = service.setPaused(row.id, true);
  await waitFor(() => pauseReachedCancellation);
  release();
  await pause;
  await assert.rejects(update, (error: unknown) => error instanceof JobServiceError && error.code === "Conflict");
  assert.deepEqual(cancellations.map((cancellation) => cancellation.schedule_id), ["replacement"]);
});

test("an update racing delete cancels its losing replacement", async () => {
  const { env } = fakeEnv();
  const cancelled: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let scheduled = false;
  const runtime = {
    schedule: async () => { scheduled = true; await gate; return "replacement"; },
    cancel: async (_env: unknown, job: JobRow) => { if (job.schedule_id) cancelled.push(job.schedule_id); },
    run: async () => ({ ok: true }),
  } as any;
  const service = new JobService(env, row.owner_email, () => new Date("2026-01-01T00:00:00Z"), runtime);
  const update = service.update(row.id, { prompt: "updated" });
  await waitFor(() => scheduled);
  assert.deepEqual(await service.delete(row.id), { deleted: row.id });
  release();
  await assert.rejects(update, (error: unknown) => error instanceof JobServiceError && error.code === "Conflict");
  assert.deepEqual(cancelled.sort(), ["replacement", "schedule-1"]);
});

test("an update racing delete retains a failed losing replacement for a later retry", async () => {
  const { env, cancellations } = fakeEnv();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let scheduled = false;
  const runtime = {
    schedule: async () => { scheduled = true; await gate; return "replacement"; },
    cancel: async (_env: unknown, job: JobRow) => {
      if (job.schedule_id === "replacement") throw new Error("native cancellation unavailable");
    },
    run: async () => ({ ok: true }),
  } as any;
  const service = new JobService(env, row.owner_email, () => new Date("2026-01-01T00:00:00Z"), runtime);

  const update = service.update(row.id, { prompt: "updated" });
  await waitFor(() => scheduled);
  assert.deepEqual(await service.delete(row.id), { deleted: row.id });
  release();
  await assert.rejects(update, (error: unknown) => error instanceof JobServiceError && error.code === "Conflict");
  assert.deepEqual(cancellations.map((cancellation) => cancellation.schedule_id), ["replacement"]);
});

test("a resume loses its replacement when a concurrent update changes the paused row", async () => {
  const { env } = fakeEnv();
  const cancelled: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let scheduled = false;
  const runtime = {
    schedule: async () => { scheduled = true; await gate; return "resume-replacement"; },
    cancel: async (_env: unknown, job: JobRow) => { if (job.schedule_id) cancelled.push(job.schedule_id); },
    run: async () => ({ ok: true }),
  } as any;
  const service = new JobService(env, row.owner_email, () => new Date("2026-01-01T00:00:00Z"), runtime);
  await service.setPaused(row.id, true);
  const resume = service.setPaused(row.id, false);
  await waitFor(() => scheduled);
  await service.update(row.id, { prompt: "paused update" });
  release();
  await assert.rejects(resume, (error: unknown) => error instanceof JobServiceError && error.code === "Conflict");
  assert.ok(cancelled.includes("resume-replacement"));
});

test("pause retains its native cancellation handle after failure and retries it", async () => {
  const { env, mutableRow } = fakeEnv();
  const cancelled: string[] = [];
  let fail = true;
  const runtime = {
    schedule: async () => "unused",
    cancel: async (_env: unknown, job: JobRow) => {
      cancelled.push(job.schedule_id!);
      if (fail) throw new Error("native cancellation unavailable");
    },
    run: async () => ({ ok: true }),
  } as any;
  const service = new JobService(env, row.owner_email, () => new Date("2026-01-01T00:00:00Z"), runtime);
  await assert.rejects(() => service.setPaused(row.id, true), /native cancellation unavailable/);
  assert.equal(mutableRow.status, "active");
  assert.equal(mutableRow.schedule_id, "schedule-1");
  fail = false;
  await service.setPaused(row.id, true);
  assert.equal(mutableRow.status, "paused");
  assert.equal(mutableRow.schedule_id, null);
  assert.deepEqual(cancelled, ["schedule-1", "schedule-1"]);
});

test("CAS losers cancel immediately when zero-row parking cannot retain the handle", async () => {
  const { env, mutableRow, cancellations } = fakeEnv(true, true, 0);
  const cancelled: string[] = [];
  const runtime = {
    schedule: async () => { mutableRow.state_version++; return "cas-loser"; },
    cancel: async (_env: unknown, job: JobRow) => { cancelled.push(job.schedule_id!); throw new Error("native cancellation unavailable"); },
    run: async () => ({ ok: true }),
  } as any;
  const service = new JobService(env, row.owner_email, () => new Date("2026-01-01T00:00:00Z"), runtime);

  await assert.rejects(() => service.update(row.id, { prompt: "updated" }), /could not be retained/);
  assert.deepEqual(cancelled, ["cas-loser"]);
  assert.equal(cancellations.length, 0);
});

test("concurrent CAS losses retain every failed native cancellation handle", async () => {
  const { env, cancellations, mutableRow } = fakeEnv();
  const scheduled: string[] = [];
  const cancelled: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const runtime = {
    schedule: async () => {
      const scheduleId = `replacement-${scheduled.length + 1}`;
      scheduled.push(scheduleId);
      await gate;
      return scheduleId;
    },
    cancel: async (_env: unknown, job: JobRow) => { cancelled.push(job.schedule_id!); throw new Error("native cancellation unavailable"); },
    run: async () => ({ ok: true }),
  } as any;
  const service = new JobService(env, row.owner_email, () => new Date("2026-01-01T00:00:00Z"), runtime);

  const first = service.update(row.id, { prompt: "first" });
  const second = service.update(row.id, { prompt: "second" });
  await waitFor(() => scheduled.length === 2);
  release();
  const results = await Promise.allSettled([first, second]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && result.reason instanceof JobServiceError && result.reason.code === "Conflict").length, 1);
  const survivor = String(mutableRow.schedule_id);
  const loser = scheduled.find((scheduleId) => scheduleId !== survivor);
  assert.ok(loser);
  assert.deepEqual(cancellations.map((cancellation) => cancellation.schedule_id).sort(), ["schedule-1", loser].sort());
  assert.deepEqual(cancelled.sort(), ["schedule-1", loser].sort());
});

test("create registration CAS loss retains its failed native cancellation handle", async () => {
  let stored: JobRow | null = null;
  const cancellations: Array<{ id: string; job_id: string; owner_email: string; session_id: string; schedule_id: string; created_at: string }> = [];
  const env = {
    DB: {
      prepare(sql: string) {
        let values: unknown[] = [];
        return {
          bind(...next: unknown[]) { values = next; return this; },
          async first() {
            if (sql.includes("FROM sessions")) return { id: values[0] };
            if (sql.includes("count(*)")) return { count: 0 };
            if (sql.includes("FROM jobs")) return stored && stored.id === values[0] && stored.owner_email === values[1] ? { ...stored } : null;
            if (sql.includes("FROM recurring_schedule_cancellations")) return null;
            return null;
          },
          async run() {
            if (sql.startsWith("INSERT INTO jobs")) {
              stored = { ...row, id: String(values[0]), owner_email: String(values[1]), session_id: String(values[2]), thread_mode: values[3] as JobRow["thread_mode"], name: String(values[4]), prompt: String(values[5]), cadence_secs: Number(values[6]), next_run_at: String(values[7]), schedule_id: null, state_version: 0 };
            } else if (sql.startsWith("UPDATE jobs SET schedule_id")) {
              return { meta: { changes: 0 } };
            } else if (sql.startsWith("INSERT OR IGNORE INTO recurring_schedule_cancellations")) {
              cancellations.push({ id: String(values[0]), job_id: String(values[1]), owner_email: String(values[2]), session_id: String(values[3]), schedule_id: String(values[4]), created_at: "now" });
            }
            return { meta: { changes: 1 } };
          },
        };
      },
    },
  } as any;
  const runtime = { schedule: async () => "native-created", cancel: async () => { throw new Error("native cancellation unavailable"); }, run: async () => ({ ok: true }) } as any;
  const service = new JobService(env, row.owner_email, () => new Date("2026-01-01T00:00:00Z"), runtime);

  await assert.rejects(() => service.create({ sessionId: row.session_id, threadMode: row.thread_mode, name: row.name, prompt: row.prompt, cadenceSecs: row.cadence_secs }), /job changed while registering/);
  assert.deepEqual(cancellations.map((cancellation) => cancellation.schedule_id), ["native-created"]);
});

test("create keeps its installed schedule when evidence persistence fails", async () => {
  let stored: any = null;
  const env = {
    DB: {
      prepare(sql: string) {
        let values: unknown[] = [];
        return {
          bind(...next: unknown[]) { values = next; return this; },
          async first() {
            if (sql.includes("FROM sessions")) return { id: values[0] };
            if (sql.includes("count(*)")) return { count: 0 };
            if (sql.includes("FROM jobs")) return stored;
            return null;
          },
          async run() {
            if (sql.startsWith("INSERT INTO jobs")) {
              stored = { ...row, id: values[0], session_id: values[2], thread_mode: values[3], name: values[4], prompt: values[5], cadence_secs: values[6], next_run_at: values[7], schedule_id: null, state_version: 0 };
            } else if (sql.startsWith("UPDATE jobs SET schedule_id")) {
              stored = { ...stored, schedule_id: values[0], state_version: 1 };
            } else if (sql.startsWith("INSERT INTO job_events")) {
              throw new Error("evidence unavailable");
            }
            return { meta: { changes: 1 } };
          },
        };
      },
    },
  } as any;
  let cancellations = 0;
  const runtime = { schedule: async () => "native-created", cancel: async () => { cancellations++; throw new Error("cancel unavailable"); }, run: async () => ({ ok: true }) } as any;
  const service = new JobService(env, row.owner_email, () => new Date("2026-01-01T00:00:00Z"), runtime);
  await assert.rejects(() => service.create({ sessionId: row.session_id, threadMode: row.thread_mode, name: row.name, prompt: row.prompt, cadenceSecs: row.cadence_secs }), /evidence unavailable/);
  assert.equal(stored.schedule_id, "native-created");
  assert.equal(cancellations, 0);
});

test("update to Specific thread persists the new target session id + mode", async () => {
  const { env, mutableRow } = fakeEnv();
  const runtime = { schedule: async () => "replacement", cancel: async () => undefined, run: async () => ({ ok: true }) } as any;
  const service = new JobService(env, row.owner_email, () => new Date("2026-01-01T00:00:00Z"), runtime);
  const updated = await service.update(row.id, { threadMode: "specific_session", sessionId: "session-chosen" });
  assert.equal(updated.thread_mode, "specific_session");
  assert.equal(updated.schedule_id, undefined);
  assert.equal(mutableRow.session_id, "session-chosen");
});

test("switching to Specific thread WITHOUT a new id is rejected (no silent retarget)", async () => {
  const { env } = fakeEnv();
  const runtime = { schedule: async () => "s", cancel: async () => undefined, run: async () => ({ ok: true }) } as any;
  const service = new JobService(env, row.owner_email, () => new Date("2026-01-01T00:00:00Z"), runtime);
  await assert.rejects(
    () => service.update(row.id, { threadMode: "specific_session" }),
    (e: unknown) => e instanceof JobServiceError && e.code === "InvalidInput",
  );
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
  events.push({ id: "event-1", ok: 1, detail_json: JSON.stringify({ scheduleId: "native-capability", replacement: "replacement-capability", scheduled: true }), idempotency_key: null });
  const service = new JobService(env, row.owner_email);
  const history = await service.history(row.id);
  assert.equal(history.length, 1);
  assert.equal(history[0].action, "delete");
  assert.deepEqual(JSON.parse(history[0].detail_json), { scheduled: true });
});
