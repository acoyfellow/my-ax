import assert from "node:assert/strict";
import test from "node:test";
import { runDeadSessionScan, DEAD_SESSION_STALL_MS, type DeadSessionDeps, type DeadSessionDb } from "./dead-session-detector";

type Session = { id: string; owner_email: string; updated_at: string; status: string };
type Entry = { id: number; session_id: string; owner_email: string; role: string; content: string | null; ts: string; meta_json: string | null };

function makeDb(sessions: Session[], entries: Entry[]) {
  const updates: Array<{ id: string; status: string }> = [];
  const db = {
      prepare(sql: string) {
        return {
          bind(...binds: unknown[]) {
            return {
              async all() {
                if (sql.includes("FROM sessions WHERE status IN")) {
                  const cutoff = String(binds[0]);
                  const rows = sessions
                    .filter((s) => (s.status === "active" || s.status === "running") && s.updated_at < cutoff)
                    .sort((a, b) => (a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : a.id < b.id ? -1 : 1))
                    .slice(0, 50);
                  return { results: rows };
                }
                if (sql.includes("FROM conversation_entries")) {
                  const [sessionId, owner] = binds as [string, string];
                  const rows = entries
                    .filter((e) => e.session_id === sessionId && e.owner_email === owner)
                    .sort((a, b) => b.id - a.id)
                    .slice(0, 12)
                    .sort((a, b) => a.id - b.id);
                  return { results: rows };
                }
                return { results: [] };
              },
              async first() {
                return null;
              },
              async run() {
                if (sql.includes("UPDATE sessions SET status = 'interrupted'")) {
                  const [id, owner] = binds as [string, string];
                  const target = sessions.find((s) => s.id === id && s.owner_email === owner && (s.status === "active" || s.status === "running"));
                  if (target) {
                    target.status = "interrupted";
                    updates.push({ id, status: "interrupted" });
                  }
                }
                return { meta: { changes: 0 } };
              },
            };
          },
        };
      },
  } as unknown as DeadSessionDb;
  return { db, updates };
}

function recordingDeps() {
  const revived: string[] = [];
  const alerted: string[] = [];
  const deps: DeadSessionDeps = {
    reviveTurn: async (_owner, sessionId) => { revived.push(sessionId); },
    alertOwner: async (_owner, sessionId) => { alerted.push(sessionId); },
  };
  return { deps, revived, alerted };
}

const now = new Date("2026-07-26T12:00:00.000Z");
const stale = new Date(now.getTime() - DEAD_SESSION_STALL_MS - 60_000).toISOString();

test("an already-retried dead session is terminalized to interrupted and alerts once", async () => {
  const sessions: Session[] = [{ id: "s-dead", owner_email: "owner@example.com", updated_at: stale, status: "running" }];
  const entries: Entry[] = [
    { id: 1, session_id: "s-dead", owner_email: "owner@example.com", role: "assistant", content: "earlier", ts: stale, meta_json: null },
    { id: 2, session_id: "s-dead", owner_email: "owner@example.com", role: "user", content: "please finish", ts: stale, meta_json: JSON.stringify({ uiMessageId: "auto-revive:2" }) },
    { id: 3, session_id: "s-dead", owner_email: "owner@example.com", role: "tool", content: "partial", ts: stale, meta_json: null },
  ];
  const { db, updates } = makeDb(sessions, entries);
  const { deps, revived, alerted } = recordingDeps();

  await runDeadSessionScan(db, deps, now);

  assert.deepEqual(alerted, ["s-dead"], "owner alerted exactly once");
  assert.deepEqual(revived, [], "no re-injection for an already-retried incident");
  assert.deepEqual(updates, [{ id: "s-dead", status: "interrupted" }], "session terminalized to interrupted");
  assert.equal(sessions[0].status, "interrupted");
});

test("a terminalized zombie is excluded from the very next scan (no starvation loop)", async () => {
  const sessions: Session[] = [{ id: "s-zombie", owner_email: "owner@example.com", updated_at: stale, status: "running" }];
  const entries: Entry[] = [
    { id: 1, session_id: "s-zombie", owner_email: "owner@example.com", role: "user", content: "hi", ts: stale, meta_json: JSON.stringify({ uiMessageId: "auto-revive:1" }) },
    { id: 2, session_id: "s-zombie", owner_email: "owner@example.com", role: "tool", content: "x", ts: stale, meta_json: null },
  ];
  const { db, updates } = makeDb(sessions, entries);
  const { deps, alerted } = recordingDeps();

  await runDeadSessionScan(db, deps, now);
  await runDeadSessionScan(db, deps, now);

  assert.equal(updates.length, 1, "terminalized exactly once across two scans");
  assert.deepEqual(alerted, ["s-zombie"], "alerted exactly once; the second scan skips the terminalized row");
});

test("a fresh dead turn (not yet retried) is revived, not terminalized", async () => {
  const sessions: Session[] = [{ id: "s-fresh", owner_email: "owner@example.com", updated_at: stale, status: "running" }];
  const entries: Entry[] = [
    { id: 1, session_id: "s-fresh", owner_email: "owner@example.com", role: "user", content: "do the thing", ts: stale, meta_json: JSON.stringify({ uiMessageId: "u-normal" }) },
    { id: 2, session_id: "s-fresh", owner_email: "owner@example.com", role: "tool", content: "partial", ts: stale, meta_json: null },
  ];
  const { db, updates } = makeDb(sessions, entries);
  const { deps, revived, alerted } = recordingDeps();

  await runDeadSessionScan(db, deps, now);

  assert.deepEqual(revived, ["s-fresh"], "first incident is retried silently");
  assert.deepEqual(alerted, [], "no owner alert on the first automatic retry");
  assert.deepEqual(updates, [], "a session pending its retry is NOT terminalized");
  assert.equal(sessions[0].status, "running");
});

test("newer stuck session is still processed even alongside older zombies", async () => {
  const older = Array.from({ length: 5 }, (_, i) => ({
    id: `zombie-${i}`,
    owner_email: "owner@example.com",
    updated_at: new Date(now.getTime() - DEAD_SESSION_STALL_MS - (1000 + i) * 1000).toISOString(),
    status: "running",
  }));
  const sessions: Session[] = [...older, { id: "s-new", owner_email: "owner@example.com", updated_at: stale, status: "running" }];
  const entries: Entry[] = [];
  for (const z of older) {
    entries.push({ id: 1, session_id: z.id, owner_email: "owner@example.com", role: "user", content: "x", ts: z.updated_at, meta_json: JSON.stringify({ uiMessageId: "auto-revive:1" }) });
    entries.push({ id: 2, session_id: z.id, owner_email: "owner@example.com", role: "tool", content: "x", ts: z.updated_at, meta_json: null });
  }
  entries.push({ id: 1, session_id: "s-new", owner_email: "owner@example.com", role: "user", content: "newer", ts: stale, meta_json: JSON.stringify({ uiMessageId: "u-normal" }) });
  entries.push({ id: 2, session_id: "s-new", owner_email: "owner@example.com", role: "tool", content: "x", ts: stale, meta_json: null });

  const { db, updates } = makeDb(sessions, entries);
  const { deps, revived, alerted } = recordingDeps();

  await runDeadSessionScan(db, deps, now);

  assert.equal(alerted.length, 5, "all five already-retried zombies alerted and terminalized");
  assert.deepEqual(revived, ["s-new"], "the newer fresh dead turn is still revived in the same batch");
  assert.equal(updates.length, 5, "five zombies terminalized");
});
