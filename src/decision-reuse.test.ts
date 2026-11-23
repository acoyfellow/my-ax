import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createDecision, registerDecisionRoutes, sameDecision } from "./routes/decisions";

function sqliteEnv() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE runs (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, session_id TEXT, status TEXT NOT NULL DEFAULT 'open', title TEXT, task_summary TEXT NOT NULL, bounds_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), dismissed_at TEXT);
    CREATE TABLE run_events (run_id TEXT NOT NULL, event_id TEXT NOT NULL, owner_email TEXT NOT NULL, ts TEXT NOT NULL, actor_json TEXT NOT NULL, type TEXT NOT NULL, data_json TEXT NOT NULL, evidence_json TEXT, PRIMARY KEY (run_id, event_id));
  `);
  const prepare = (sql: string) => ({
    bind: (...params: unknown[]) => ({
      first: async () => db.prepare(sql).get(...(params as never[])) ?? null,
      all: async () => ({ results: db.prepare(sql).all(...(params as never[])) }),
      run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...(params as never[])).changes) } }),
    }),
  });
  const status = (id: string) => (db.prepare("SELECT status FROM runs WHERE id = ?").get(id) as { status: string } | undefined)?.status;
  const events = (id: string) => db.prepare("SELECT type, data_json FROM run_events WHERE run_id = ?").all(id) as Array<{ type: string; data_json: string }>;
  return { env: { DB: { prepare } } as never, status, events, db };
}

const OWNER = "owner@example.com";

test("the same question with different options gets a new decision, not the stale one", async () => {
  const { env } = sqliteEnv();
  const first = await createDecision(env, OWNER, "s1", "Which flight?", ["UA 123", "DL 456"]);
  const second = await createDecision(env, OWNER, "s1", "Which flight?", ["B6 789", "AA 12"]);
  assert.notEqual(second.id, first.id);
  assert.equal("reused" in second, false);
});

test("a retried identical decision is still reused, so the owner gets one widget and one push", async () => {
  const { env } = sqliteEnv();
  const first = await createDecision(env, OWNER, "s1", "Which flight?", ["UA 123", "DL 456"]);
  const retry = await createDecision(env, OWNER, "s1", "Which flight?", ["UA 123", "DL 456"]);
  assert.equal(retry.id, first.id);
  assert.equal(retry.reused, true);
});

test("reordered options are a different decision", async () => {
  const { env } = sqliteEnv();
  const first = await createDecision(env, OWNER, "s1", "Which flight?", ["UA 123", "DL 456"]);
  const reordered = await createDecision(env, OWNER, "s1", "Which flight?", ["DL 456", "UA 123"]);
  assert.notEqual(reordered.id, first.id);
});

test("two questions sharing their first 200 characters do not collide", async () => {
  const { env, status } = sqliteEnv();
  const prefix = "x".repeat(200);
  const first = await createDecision(env, OWNER, "s1", `${prefix} pick a color`, ["red", "blue"]);
  const second = await createDecision(env, OWNER, "s1", `${prefix} pick a size`, ["red", "blue"]);
  assert.notEqual(second.id, first.id);
  assert.equal(status(first.id), "open");
  assert.equal(status(second.id), "open");
});

test("the stale decision is retired and points at its replacement", async () => {
  const { env, status, events } = sqliteEnv();
  const first = await createDecision(env, OWNER, "s1", "Which flight?", ["UA 123", "DL 456"]);
  const second = await createDecision(env, OWNER, "s1", "Which flight?", ["B6 789", "AA 12"]);
  assert.equal(status(first.id), "aborted");
  assert.equal(status(second.id), "open");
  assert.deepEqual("superseded" in second ? second.superseded : undefined, [first.id]);
  const superseded = events(first.id).find((event) => event.type === "decision.superseded");
  assert.equal(JSON.parse(superseded!.data_json).replacedBy, second.id);
});

test("decisions in other sessions or for other owners are never reused or retired", async () => {
  const { env, status } = sqliteEnv();
  const mine = await createDecision(env, OWNER, "s1", "Which flight?", ["UA 123", "DL 456"]);
  const otherSession = await createDecision(env, OWNER, "s2", "Which flight?", ["B6 789", "AA 12"]);
  const otherOwner = await createDecision(env, "someone@example.com", "s1", "Which flight?", ["UA 123", "DL 456"]);
  assert.notEqual(otherSession.id, mine.id);
  assert.notEqual(otherOwner.id, mine.id);
  assert.equal(status(mine.id), "open");
});

test("an answered decision is not retired when the question is asked again", async () => {
  const { env, status } = sqliteEnv();
  const first = await createDecision(env, OWNER, "s1", "Which flight?", ["UA 123", "DL 456"]);
  await (env as { DB: { prepare: (sql: string) => { bind: (...p: unknown[]) => { run: () => Promise<unknown> } } } }).DB.prepare("UPDATE runs SET status = 'completed' WHERE id = ?").bind(first.id).run();
  const second = await createDecision(env, OWNER, "s1", "Which flight?", ["B6 789", "AA 12"]);
  assert.equal(status(first.id), "completed");
  assert.equal("superseded" in second, false);
});

test("option comparison is exact", () => {
  assert.equal(sameDecision({ question: "q", options: ["a", "b"] }, "q", ["a", "b"]), true);
  assert.equal(sameDecision({ question: "q", options: ["a", "b"] }, "q", ["a", "b", "c"]), false);
  assert.equal(sameDecision({ question: "q", options: ["a", "b"] }, "q ", ["a", "b"]), false);
});

async function routes() {
  const { Hono } = await import("hono");
  const fixture = sqliteEnv();
  const app = new Hono<never>();
  app.use("*", async (c, next) => { (c as unknown as { set: (k: string, v: unknown) => void }).set("identity", { email: OWNER }); await next(); });
  registerDecisionRoutes(app as never);
  const request = (path: string, init?: RequestInit) => app.request(path, init, fixture.env);
  return { ...fixture, request };
}

test("answering a retired decision is refused, so the agent never gets a choice it no longer offered", async () => {
  const { env, request } = await routes();
  const first = await createDecision(env, OWNER, "s1", "Which flight?", ["UA 123", "DL 456"]);
  await createDecision(env, OWNER, "s1", "Which flight?", ["B6 789", "AA 12"]);
  const response = await request(`/api/decisions/${first.id}/respond`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ choice: "UA 123" }) });
  assert.equal(response.status, 409);
  assert.equal(((await response.json()) as { error: { code: string } }).error.code, "DECISION_SUPERSEDED");
});

test("opening a retired decision link redirects to its replacement", async () => {
  const { env, request } = await routes();
  const first = await createDecision(env, OWNER, "s1", "Which flight?", ["UA 123", "DL 456"]);
  const second = await createDecision(env, OWNER, "s1", "Which flight?", ["B6 789", "AA 12"]);
  const response = await request(`/api/decisions/${first.id}`);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), `/?session=s1&decision=${second.id}`);
  const pending = await request("/api/decisions/pending?sessionId=s1");
  assert.equal(((await pending.json()) as { result: { decision: { id: string } } }).result.decision.id, second.id);
});

test("dismissing an open decision closes it for good: the state says dismissed and pending is empty", async () => {
  const { env, request, status, events } = await routes();
  const open = await createDecision(env, OWNER, "s1", "Which flight?", ["UA 123", "DL 456"]);
  const response = await request(`/api/decisions/${open.id}/dismiss`, { method: "POST" });
  assert.equal(response.status, 200);
  assert.equal(((await response.json()) as { result: { outcome: string } }).result.outcome, "dismissed");
  assert.equal(status(open.id), "aborted");
  assert.deepEqual(events(open.id).map((event) => event.type), ["decision.dismissed"]);
  const state = (await (await request(`/api/decisions/${open.id}/state`)).json()) as { result: { state: string } };
  assert.equal(state.result.state, "dismissed");
  const pending = (await (await request("/api/decisions/pending?sessionId=s1")).json()) as { result: { decision: unknown } };
  assert.equal(pending.result.decision, null);
});

test("a dismissed decision refuses a late answer, so a stale push button cannot resume the agent", async () => {
  const { env, request } = await routes();
  const open = await createDecision(env, OWNER, "s1", "Which flight?", ["UA 123", "DL 456"]);
  await request(`/api/decisions/${open.id}/dismiss`, { method: "POST" });
  const late = await request(`/api/decisions/${open.id}/respond`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ choice: "UA 123" }) });
  assert.equal(late.status, 409);
  assert.equal(((await late.json()) as { error: { code: string } }).error.code, "DECISION_DISMISSED");
});

test("dismissing twice, or dismissing an answered decision, changes nothing", async () => {
  const { env, request, status, events, db } = await routes();
  const open = await createDecision(env, OWNER, "s1", "Which flight?", ["UA 123", "DL 456"]);
  await request(`/api/decisions/${open.id}/dismiss`, { method: "POST" });
  const again = (await (await request(`/api/decisions/${open.id}/dismiss`, { method: "POST" })).json()) as { result: { outcome: string } };
  assert.equal(again.result.outcome, "already_closed");
  assert.equal(events(open.id).length, 1);
  const other = await createDecision(env, OWNER, "s2", "Ship it?", ["Yes", "No"]);
  db.prepare("UPDATE runs SET status = 'completed' WHERE id = ?").run(other.id);
  const answered = (await (await request(`/api/decisions/${other.id}/dismiss`, { method: "POST" })).json()) as { result: { outcome: string } };
  assert.equal(answered.result.outcome, "already_closed");
  assert.equal(status(other.id), "completed");
});

test("one owner cannot dismiss another owner's decision", async () => {
  const { env, request, status } = await routes();
  const theirs = await createDecision(env, "someone-else@example.com", "s1", "Which flight?", ["UA 123", "DL 456"]);
  const response = await request(`/api/decisions/${theirs.id}/dismiss`, { method: "POST" });
  assert.equal(response.status, 404);
  assert.equal(status(theirs.id), "open");
});
