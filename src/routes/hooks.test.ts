import assert from "node:assert/strict";
import test from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { constantTimeEqual, extractHookBearer, mintHookToken, sha256Hex } from "../conversation-hooks";
import { verifyAccessForHook } from "../auth";
import { registerHookCallerRoutes, registerHookOwnerRoutes, type HookDeps } from "./hooks";

type Row = { id: string; owner_email: string; session_id: string; label: string; token_hash: string; revoked_at: string | null };

function fakeDb(rows: Row[]) {
  return {
    prepare(sql: string) {
      let args: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          args = values;
          return statement;
        },
        async first() {
          if (sql.includes("FROM conversation_hooks")) return rows.find((row) => row.id === args[0]) ?? null;
          if (sql.includes("FROM sessions")) return args[1] === "owner@example.com" ? { id: args[0] } : null;
          return null;
        },
        async all() {
          return { results: rows.filter((row) => !row.revoked_at && row.session_id === args[1]).map(({ id, label }) => ({ id, label, created_at: "now" })) };
        },
        async run() {
          if (sql.startsWith("INSERT")) rows.push({ id: args[0] as string, owner_email: args[1] as string, session_id: args[2] as string, label: args[3] as string, token_hash: args[4] as string, revoked_at: null });
          if (sql.startsWith("UPDATE")) {
            const hook = rows.find((row) => row.id === args[0] && !row.revoked_at);
            if (hook) hook.revoked_at = "now";
            return { meta: { changes: hook ? 1 : 0 } };
          }
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
  };
}

async function seedHook(rows: Row[], sessionId: string, revoked = false) {
  const token = mintHookToken();
  rows.push({ id: "hook-1", owner_email: "owner@example.com", session_id: sessionId, label: "t", token_hash: await sha256Hex(token), revoked_at: revoked ? "then" : null });
  return token;
}

function build(rows: Row[], opened: string[], texts: string[], accessOk = true) {
  const deps: HookDeps = {
    verifyAccess: async () => {
      if (!accessOk) throw new Error("denied");
      return { kind: "service", subject: "svc" };
    },
    openChat: async (_env, _owner, sessionId) => {
      opened.push(sessionId);
      return {
        submit: async (text) => {
          texts.push(text);
          return { operationId: "op-1", accepted: true };
        },
        wait: async () => ({ status: "completed", text: "hello back" }),
        setModel: async () => {},
      };
    },
  };
  const app = new Hono<AppEnv>();
  registerHookCallerRoutes(app, deps);
  app.use("/api/*", async (c) => c.json({ reachedAccess: true }, 401));
  const env = { DB: fakeDb(rows) } as unknown as AppEnv["Bindings"];
  return (path: string, init?: RequestInit) => app.fetch(new Request(`https://x.test${path}`, init), env);
}

const post = (token: string | null, body: unknown = { text: "hi" }) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});

test("sha256Hex hashes deterministically", async () => {
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("constantTimeEqual compares strings", () => {
  assert.equal(constantTimeEqual("abc", "abc"), true);
  assert.equal(constantTimeEqual("abc", "abd"), false);
  assert.equal(constantTimeEqual("abc", "abcd"), false);
});

test("extractHookBearer reads Authorization and X-MyAx-Hook-Token", () => {
  assert.equal(extractHookBearer(new Request("https://x", { headers: { Authorization: "Bearer tok" } })), "tok");
  assert.equal(extractHookBearer(new Request("https://x", { headers: { "X-MyAx-Hook-Token": "tok2" } })), "tok2");
  assert.equal(extractHookBearer(new Request("https://x")), null);
});

test("mintHookToken yields unique prefixed tokens", () => {
  assert.notEqual(mintHookToken(), mintHookToken());
  assert.match(mintHookToken(), /^mah_[A-Za-z0-9_-]{43}$/);
});

test("verifyAccessForHook accepts service token JWT and user JWT, rejects wrong aud", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const issuer = "https://team.cloudflareaccess.com";
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => String(input).includes("/cdn-cgi/access/certs") ? Response.json({ keys: [jwk] }) : realFetch(input)) as typeof fetch;
  try {
    const sign = (claims: Record<string, unknown>, aud = "aud-1") =>
      new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(issuer).setAudience(aud).setIssuedAt().setExpirationTime("5m").sign(privateKey);
    const env = { CF_ACCESS_AUD: "aud-1", CF_ACCESS_ISS: issuer } as never;
    const request = (jwt: string) => new Request("https://my.ax/api/hook/h/message", { headers: { "Cf-Access-Jwt-Assertion": jwt } });
    assert.deepEqual(await verifyAccessForHook(request(await sign({ common_name: "svc-id.access" })), env), { kind: "service", subject: "svc-id.access" });
    const user = await verifyAccessForHook(request(await sign({ email: "A@B.com", sub: "u1" })), env);
    assert.equal(user.email, "a@b.com");
    await assert.rejects(verifyAccessForHook(request(await sign({ common_name: "svc" }, "other")), env));
    await assert.rejects(verifyAccessForHook(request(await sign({ sub: "nobody" })), env));
    await assert.rejects(verifyAccessForHook(new Request("https://my.ax/x"), env));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("missing or wrong hook token is 401 and never opens the chat", async () => {
  const rows: Row[] = [];
  const opened: string[] = [];
  await seedHook(rows, "sess-aaaa");
  const fetch = build(rows, opened, []);
  assert.equal((await fetch("/api/hook/hook-1/message", post(null))).status, 401);
  assert.equal((await fetch("/api/hook/hook-1/message", post("wrong"))).status, 401);
  assert.equal((await fetch("/api/hook/nope/message", post("wrong"))).status, 401);
  assert.deepEqual(opened, []);
});

test("failed Access verification is 401 even with a valid hook token", async () => {
  const rows: Row[] = [];
  const token = await seedHook(rows, "sess-aaaa");
  const response = await build(rows, [], [], false)("/api/hook/hook-1/message", post(token));
  assert.equal(response.status, 401);
});

test("revoked hook is rejected", async () => {
  const rows: Row[] = [];
  const opened: string[] = [];
  const token = await seedHook(rows, "sess-aaaa", true);
  const response = await build(rows, opened, [])("/api/hook/hook-1/message", post(token));
  assert.equal(response.status, 403);
  assert.deepEqual(opened, []);
});

test("message relays only into the pinned session and returns text", async () => {
  const rows: Row[] = [];
  const opened: string[] = [];
  const texts: string[] = [];
  const token = await seedHook(rows, "sess-pinned");
  const response = await build(rows, opened, texts)("/api/hook/hook-1/message", post(token, { text: "ping", session_id: "sess-other" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, operationId: "op-1", status: "completed", text: "hello back" });
  assert.deepEqual(opened, ["sess-pinned"]);
  assert.deepEqual(texts, ["ping"]);
});

test("wait=0 returns 202 and X-MyAx-Hook-Token header works", async () => {
  const rows: Row[] = [];
  const token = await seedHook(rows, "sess-pinned");
  const response = await build(rows, [], [])("/api/hook/hook-1/message?wait=0", { method: "POST", headers: { "X-MyAx-Hook-Token": token }, body: JSON.stringify({ text: "x" }) });
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true, operationId: "op-1", status: "running" });
});

test("stream=1 emits SSE events", async () => {
  const rows: Row[] = [];
  const token = await seedHook(rows, "sess-pinned");
  const response = await build(rows, [], [])("/api/hook/hook-1/message?stream=1", post(token));
  assert.equal(response.headers.get("Content-Type"), "text/event-stream");
  const body = await response.text();
  for (const event of ["start", "delta", "status", "done"]) assert.match(body, new RegExp(`event: ${event}\\n`));
});

test("turn lookup stays inside the pinned session", async () => {
  const rows: Row[] = [];
  const opened: string[] = [];
  const token = await seedHook(rows, "sess-pinned");
  const response = await build(rows, opened, [])("/api/hook/hook-1/turns/op-9", { headers: { Authorization: `Bearer ${token}` } });
  assert.deepEqual(await response.json(), { ok: true, operationId: "op-9", status: "completed", text: "hello back" });
  assert.deepEqual(opened, ["sess-pinned"]);
});

test("owner routes create, list without token_hash, and revoke", async () => {
  const rows: Row[] = [];
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("identity", { email: "owner@example.com", sub: "s" });
    await next();
  });
  registerHookOwnerRoutes(app);
  const env = { DB: fakeDb(rows) } as unknown as AppEnv["Bindings"];
  const call = (path: string, init?: RequestInit) => app.fetch(new Request(`https://x.test${path}`, init), env);
  const created = await (await call("/api/sessions/sess-1/hooks", { method: "POST", body: JSON.stringify({ label: "ci" }) })).json() as { id: string; token: string; baseUrl: string };
  assert.equal(rows[0].token_hash, await sha256Hex(created.token));
  assert.equal(created.baseUrl, `https://x.test/api/hook/${created.id}`);
  const listed = await (await call("/api/sessions/sess-1/hooks")).text();
  assert.ok(!listed.includes("token_hash") && !listed.includes(created.token));
  assert.equal((await call(`/api/sessions/sess-1/hooks/${created.id}`, { method: "DELETE" })).status, 200);
  assert.ok(rows[0].revoked_at);
  assert.equal((await call(`/api/sessions/sess-1/hooks/${created.id}`, { method: "DELETE" })).status, 404);
});
