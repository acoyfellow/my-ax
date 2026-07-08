import assert from "node:assert/strict";
import test from "node:test";
import type { Env } from "./types";
import { notifyOwner, DEDUPE_WINDOW_MS } from "./notify";

// Regression coverage for the push 429 flood: notifyOwner accepted a dedupeKey
// but never used it, so repeat events (recurring-job ticks, dead-session
// rechecks, delegate receipts) fired a fresh Web Push every time and the
// provider eventually returned 429. These tests prove the same dedupeKey
// within the window suppresses the resend, while distinct/expired/keyless
// notifications still deliver.

type AttentionRow = { id: string; owner_email: string; dedupe_key: string | null; created_at: string };

function makeEnv() {
  const attention: AttentionRow[] = [];
  // One subscribed device so a real delivery attempt is observable.
  const subs = [{ endpoint: "https://push.example/ep1", subscription_json: "{}" }];
  const db = {
    prepare(sql: string) {
      const q = sql.replace(/\s+/g, " ").trim();
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) { bound = args; return stmt; },
        async first<T = unknown>() {
          if (/SELECT id FROM attention_items WHERE owner_email = \? AND dedupe_key = \? AND created_at >= \?/.test(q)) {
            const [owner, key, cutoff] = bound as [string, string, string];
            const hit = attention.find((r) => r.owner_email === owner && r.dedupe_key === key && r.created_at >= cutoff);
            return (hit ?? null) as T;
          }
          if (/SELECT COUNT\(\*\) AS count FROM attention_items/.test(q)) {
            return { count: attention.length } as T;
          }
          return null as T;
        },
        async all<T = unknown>() {
          if (/FROM push_subscriptions WHERE owner_email = \?/.test(q)) {
            return { results: subs as unknown as T[] };
          }
          return { results: [] as T[] };
        },
        async run() {
          if (/^INSERT INTO attention_items/.test(q)) {
            // columns: id, owner_email, session_id, kind, title, body, href, dedupe_key
            attention.push({ id: String(bound[0]), owner_email: String(bound[1]), dedupe_key: (bound[7] as string | null) ?? null, created_at: nowSql() });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
      };
      return stmt;
    },
  };
  const env = { DB: db, BRIDGE_BASE_URL: "https://my.ax.example" } as unknown as Env;
  // We assert on receipt.devices (0 only when deduped early-return; otherwise
  // the number of subscriptions a delivery was attempted against) rather than
  // on fetch, because sendPush validates the subscription crypto before any
  // network call. The dedupe decision happens before subscriptions are even
  // read, so devices===0 iff the send was suppressed.
  return { env, attention, restore: () => {} };
}

function nowSql(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

const OWNER = "owner@example.com";
const base = { kind: "job.complete" as const, title: "Job done", body: "ok", href: "/" };

test("same dedupeKey within the window suppresses the resend (no second push)", async () => {
  const h = makeEnv();
  try {
    const first = await notifyOwner(h.env, OWNER, { ...base, dedupeKey: "recurring-job:J1:S1:run5" });
    assert.equal(first.devices, 1, "first send targets the subscribed device");
    const second = await notifyOwner(h.env, OWNER, { ...base, dedupeKey: "recurring-job:J1:S1:run5" });
    assert.equal(second.devices, 0, "deduped send targets no device (no push attempted)");
    assert.equal(second.delivered, 0);
    assert.equal(second.failed, 0, "a suppressed send is not a failure");
  } finally { h.restore(); }
});

test("distinct dedupeKeys both deliver", async () => {
  const h = makeEnv();
  try {
    await notifyOwner(h.env, OWNER, { ...base, dedupeKey: "recurring-job:J1:S1:run5" });
    const second = await notifyOwner(h.env, OWNER, { ...base, dedupeKey: "recurring-job:J1:S1:run6" });
    assert.equal(second.devices, 1, "a different event still attempts delivery");
  } finally { h.restore(); }
});

test("no dedupeKey always delivers (turn-completion style events are never suppressed)", async () => {
  const h = makeEnv();
  try {
    const first = await notifyOwner(h.env, OWNER, { ...base });
    const second = await notifyOwner(h.env, OWNER, { ...base });
    assert.equal(first.devices, 1);
    assert.equal(second.devices, 1, "keyless notifications are independent and always attempt delivery");
  } finally { h.restore(); }
});

test("an identical key older than the window delivers again", async () => {
  const h = makeEnv();
  try {
    // Seed an old attention row for the key, outside the dedupe window.
    const old = new Date(Date.now() - DEDUPE_WINDOW_MS - 60_000).toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
    h.attention.push({ id: "old", owner_email: OWNER, dedupe_key: "session-dead:S1:E1", created_at: old });
    const res = await notifyOwner(h.env, OWNER, { ...base, dedupeKey: "session-dead:S1:E1" });
    assert.equal(res.devices, 1, "an expired dedupe entry must not suppress a fresh occurrence");
  } finally { h.restore(); }
});
