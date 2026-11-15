import assert from "node:assert/strict";
import { test } from "node:test";
import { settleDecisionNotifications } from "./routes/decisions";
import { testDb } from "./domain/test-db";

const OWNER = "o@x";
const DECISION = "run-decision-11111111-1111-4111-8111-111111111111";

function env() {
  const db = testDb();
  db.exec(`INSERT INTO attention_items (id, owner_email, kind, title, body, href, notification_tag, created_at) VALUES ('a1', '${OWNER}', 'job.needs_input', 't', 'b', '/', 'decision:${DECISION}', datetime('now'))`);
  db.exec(`INSERT INTO attention_items (id, owner_email, kind, title, body, href, notification_tag, created_at) VALUES ('a2', '${OWNER}', 'job.complete', 't', 'b', '/', 'other', datetime('now'))`);
  return { DB: db, VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "" } as never as Parameters<typeof settleDecisionNotifications>[0] & { DB: ReturnType<typeof testDb> };
}

test("answering a decision marks only its notification seen", async () => {
  const e = env();
  await settleDecisionNotifications(e, OWNER, DECISION);
  const rows = e.DB.rows<{ id: string; seen_at: string | null }>("SELECT id, seen_at FROM attention_items ORDER BY id");
  assert.ok(rows[0]?.seen_at, "decision item is seen");
  assert.equal(rows[1]?.seen_at, null, "other item stays unread");
});

test("settling never throws, even when the database fails", async () => {
  const broken = { DB: { prepare() { throw new Error("down"); } } } as never;
  await assert.doesNotReject(settleDecisionNotifications(broken, OWNER, DECISION));
});
