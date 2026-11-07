import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { registerSessionRoutes } from "./sessions";

type StoredSession = { id: string; name: string; owner_email: string; stable_name: string | null };
type QueryCall = { sql: string; binds: unknown[] };

function makeSessionApp(initialOwner = "owner@example.com") {
  const sessions: StoredSession[] = [];
  const calls: QueryCall[] = [];
  let owner = initialOwner;
  const DB = {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          binds = values;
          return statement;
        },
        async run() {
          calls.push({ sql, binds });
          if (sql.startsWith("INSERT INTO sessions") && sql.includes("stable_name")) {
            const [id, name, stableName, ownerEmail] = binds as [string, string, string, string];
            if (sessions.some((session) => session.owner_email === ownerEmail && session.stable_name === stableName)) {
              return { meta: { changes: 0 } };
            }
            sessions.push({ id, name, owner_email: ownerEmail, stable_name: stableName });
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("INSERT INTO sessions")) {
            const [id, name, ownerEmail] = binds as [string, string, string];
            sessions.push({ id, name, owner_email: ownerEmail, stable_name: null });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 1 } };
        },
        async all() {
          calls.push({ sql, binds });
          return { results: [] };
        },
        async first<T>() {
          calls.push({ sql, binds });
          if (sql.includes("WHERE owner_email = ? AND stable_name = ?")) {
            return (sessions.find((session) => session.owner_email === binds[0] && session.stable_name === binds[1]) ?? null) as T | null;
          }
          return null;
        },
      };
      return statement;
    },
  };
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("identity", { email: owner, sub: owner });
    await next();
  });
  registerSessionRoutes(app);
  return { app, DB, calls, sessions, setOwner(nextOwner: string) { owner = nextOwner; } };
}

async function createSession(app: Hono<AppEnv>, DB: unknown, body: unknown) {
  return app.fetch(new Request("https://my.ax.test/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }), { DB } as never);
}

test("stableName atomically creates then reuses one durable owner session", async () => {
  const { app, DB, calls, sessions } = makeSessionApp();
  const first = await createSession(app, DB, { stableName: "Scheduled notifications" });
  assert.equal(first.status, 201);
  const firstBody = await first.json<any>();
  assert.equal(firstBody.result.created, true);
  assert.equal(firstBody.result.stableName, "Scheduled notifications");
  assert.equal(sessions.length, 1);

  sessions[0]!.name = "Owner-renamed notifications";
  const second = await createSession(app, DB, { stableName: "  Scheduled   notifications  " });
  assert.equal(second.status, 200);
  const secondBody = await second.json<any>();
  assert.equal(secondBody.result.created, false);
  assert.equal(secondBody.result.sessionId, firstBody.result.sessionId);
  assert.equal(secondBody.result.name, "Owner-renamed notifications");
  assert.equal(sessions.length, 1);
  assert.ok(calls.some((call) => call.sql.includes("ON CONFLICT(owner_email, stable_name) WHERE stable_name IS NOT NULL DO NOTHING") && call.binds[2] === "Scheduled notifications"));
  assert.ok(calls.some((call) => call.sql.includes("WHERE owner_email = ? AND stable_name = ?") && call.binds[1] === "Scheduled notifications"));
});

test("stableName is isolated per owner", async () => {
  const { app, DB, sessions, setOwner } = makeSessionApp();
  const first = await createSession(app, DB, { stableName: "Automation" });
  setOwner("other@example.com");
  const second = await createSession(app, DB, { stableName: "Automation" });
  const firstBody = await first.json<any>();
  const secondBody = await second.json<any>();
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.notEqual(firstBody.result.sessionId, secondBody.result.sessionId);
  assert.deepEqual(sessions.map((session) => [session.owner_email, session.stable_name]), [
    ["owner@example.com", "Automation"],
    ["other@example.com", "Automation"],
  ]);
});

test("user-created sessions retain create-every-time behavior even with the same display name", async () => {
  const { app, DB, sessions } = makeSessionApp();
  const first = await createSession(app, DB, { name: "Project notes" });
  const second = await createSession(app, DB, { name: "Project notes" });
  const firstBody = await first.json<any>();
  const secondBody = await second.json<any>();
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(firstBody.result.created, true);
  assert.equal(secondBody.result.created, true);
  assert.notEqual(firstBody.result.sessionId, secondBody.result.sessionId);
  assert.deepEqual(sessions.map((session) => session.stable_name), [null, null]);
});

test("stableName rejects empty and overlong Unicode names before any session write", async () => {
  const { app, DB, sessions } = makeSessionApp();
  const empty = await createSession(app, DB, { stableName: "   " });
  const overlong = await createSession(app, DB, { stableName: "😀".repeat(61) });
  assert.equal(empty.status, 400);
  assert.equal(overlong.status, 400);
  assert.equal((await empty.json<any>()).error.code, "INVALID_STABLE_NAME");
  assert.match((await overlong.json<any>()).error.message, /60 Unicode code points/);
  assert.equal(sessions.length, 0);
});

test("archive goes through the session state machine for the signed-in owner only", async () => {
  const { app, DB, calls } = makeSessionApp();
  const response = await app.fetch(new Request("https://my.ax.test/api/sessions/s1/archive", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ archived: true }) }), { DB } as never);
  assert.equal(response.status, 200);
  const update = calls.find((call) => call.sql.startsWith("UPDATE sessions SET status"));
  assert.ok(update);
  assert.deepEqual(update.binds.slice(0, 3), ["archived", "s1", "owner@example.com"]);
  assert.ok(!update.binds.slice(3).includes("running"));
});

test("archive rejects a body without a boolean", async () => {
  const { app, DB } = makeSessionApp();
  const response = await app.fetch(new Request("https://my.ax.test/api/sessions/s1/archive", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ archived: "yes" }) }), { DB } as never);
  assert.equal(response.status, 400);
});

test("the session list hides archived conversations unless asked for them", async () => {
  const { app, DB, calls } = makeSessionApp();
  await app.fetch(new Request("https://my.ax.test/api/sessions"), { DB } as never);
  assert.ok(calls.filter((call) => call.sql.includes("FROM sessions WHERE owner_email")).every((call) => call.sql.includes("status != 'archived'")));
  calls.length = 0;
  await app.fetch(new Request("https://my.ax.test/api/sessions?archived=1"), { DB } as never);
  assert.ok(calls.filter((call) => call.sql.includes("FROM sessions WHERE owner_email")).every((call) => call.sql.includes("status = 'archived'")));
});
