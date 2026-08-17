import assert from "node:assert/strict";
import test from "node:test";
import type { Env } from "./types";
import { buildOwnerPushPayload, notifyOwner } from "./notify";

function progressEnv() {
  const reservations: number[] = [];
  let attentionInserts = 0;
  const db = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bound = values; return statement; },
        async first<T = unknown>() {
          if (sql.includes("SELECT COUNT(*) AS count FROM attention_items")) return { count: attentionInserts } as T;
          return null as T;
        },
        async all<T = unknown>() {
          if (sql.includes("FROM push_subscriptions")) return { results: [] as T[] };
          if (sql.includes("FROM push_dismissals")) return { results: [] as T[] };
          return { results: [] as T[] };
        },
        async run() {
          if (sql.includes("INSERT INTO push_progress_updates")) {
            const changes = reservations.length === 0 ? 1 : 0;
            reservations.push(changes);
            return { meta: { changes } };
          }
          if (sql.includes("INSERT INTO attention_items")) {
            attentionInserts += 1;
            assert.equal(bound.at(-1), "job:weekly-report");
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
  };
  return { env: { DB: db, BRIDGE_BASE_URL: "https://my-ax.test" } as unknown as Env, reservations, attentionInserts: () => attentionInserts };
}

const runningJob = {
  kind: "job.complete" as const,
  title: "Weekly report",
  body: "Fetching source data",
  href: "/?session=11111111-1111-4111-8111-111111111111",
  progressTag: "job:weekly-report",
};

test("intermediate job progress reuses one tag, skips Attention, and is rate-limited before one terminal Attention", async () => {
  const firstPayload = buildOwnerPushPayload({ ...runningJob, progressTerminal: false }, {
    destinationHref: runningJob.href,
    unread: 4,
    progressTag: runningJob.progressTag,
    progressTerminal: false,
  }).payload;
  const terminalPayload = buildOwnerPushPayload({ ...runningJob, body: "Weekly report finished", progressTerminal: true }, {
    destinationHref: runningJob.href,
    attentionId: "11111111-1111-4111-8111-111111111111",
    unread: 5,
    progressTag: runningJob.progressTag,
    progressTerminal: true,
  }).payload;
  assert.equal(firstPayload.progressTag, "job:weekly-report");
  assert.equal(terminalPayload.progressTag, "job:weekly-report");
  assert.equal(firstPayload.progressTerminal, false);
  assert.equal(terminalPayload.progressTerminal, true);

  const fixture = progressEnv();
  await notifyOwner(fixture.env, "owner@example.com", { ...runningJob, progressTerminal: false });
  const rateLimited = await notifyOwner(fixture.env, "owner@example.com", { ...runningJob, body: "Still fetching", progressTerminal: false });
  await notifyOwner(fixture.env, "owner@example.com", { ...runningJob, body: "Weekly report finished", progressTerminal: true });

  assert.deepEqual(fixture.reservations, [1, 0]);
  assert.equal(rateLimited.devices, 0);
  assert.equal(fixture.attentionInserts(), 1);
});
