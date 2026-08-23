import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { AGENTCAST_WORK_METHODS, createAgentCastWorkProvider } from "./agentcast-tools";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const sessionId = "123e4567-e89b-42d3-a456-426614174000";

function ctxWith(fetchImpl: typeof fetch, env: Record<string, unknown> = {}) {
  globalThis.fetch = fetchImpl;
  return {
    env: { AGENTCAST_ISSUER_KEY: "iss_test", ...env },
    identity: { email: "owner@example.com" },
  } as any;
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("catalog advertises open, instruct, status, record, stop", () => {
  assert.deepEqual(AGENTCAST_WORK_METHODS.map((m) => m.name).sort(), ["instruct", "open", "record", "status", "stop"]);
});

test("configuration fails closed without an issuer key", async () => {
  const provider = createAgentCastWorkProvider(ctxWith((async () => jsonResponse(200, {})) as any, { AGENTCAST_ISSUER_KEY: "", AGENTCAST_CONTROL_TOKEN: "" }));
  await assert.rejects(() => provider.fns.open({ instruction: "goto https://agentcast.dev" }), /not configured/);
});

test("open rejects workers.dev origins", async () => {
  const provider = createAgentCastWorkProvider(ctxWith((async () => jsonResponse(200, {})) as any, {
    AGENTCAST_URL: "https://agentcast-worker.coy.workers.dev",
  }));
  await assert.rejects(() => provider.fns.open({ instruction: "goto https://agentcast.dev" }), /workers.dev/);
});

test("open mints a capability then runs create, poll, wake, instruct, and ticket over HTTPS", async () => {
  const calls: Array<{ url: string; method: string; auth: string | undefined; body?: string }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(url), method: init?.method ?? "GET", auth: headers.authorization, body: typeof init?.body === "string" ? init.body : undefined });
    const path = new URL(String(url)).pathname;
    if (path === "/internal/capabilities") return jsonResponse(200, { token: "cap_live", expiresAt: Date.now() + 60_000 });
    if (path === "/api/session" && init?.method === "POST") return jsonResponse(200, { success: true, data: { sessionId } });
    if (path === `/api/session/${sessionId}` && (init?.method ?? "GET") === "GET") return jsonResponse(200, { id: sessionId, status: "ready" });
    if (path.endsWith("/wake")) return jsonResponse(200, { success: true, status: { id: sessionId, status: "ready" } });
    if (path.endsWith("/instruction")) return jsonResponse(200, { success: true, response: "ok" });
    if (path.endsWith("/view-ticket")) return jsonResponse(200, { ticketUrl: "https://api.agentcast.dev/ticket/fixture-ticket" });
    throw new Error(`unexpected ${path}`);
  }) as any;
  const provider = createAgentCastWorkProvider(ctxWith(fetchImpl));
  const res = await provider.fns.open({ instruction: "goto https://agentcast.dev", name: "my-ax" }) as any;
  assert.equal(res.ok, true);
  assert.equal(res.sessionId, sessionId);
  assert.equal(res.transport, "http");
  assert.equal(res.ticketUrl, "https://api.agentcast.dev/ticket/fixture-ticket");
  const issue = calls.find((c) => new URL(c.url).pathname === "/internal/capabilities");
  assert.ok(issue);
  assert.equal(issue!.auth, "Bearer iss_test");
  assert.match(issue!.body ?? "", /"sessionId":"\*"/);
  assert.ok(calls.filter((c) => !c.url.endsWith("/internal/capabilities")).every((c) => c.auth === "Bearer cap_live"));
  assert.deepEqual(calls.filter((c) => !c.url.endsWith("/internal/capabilities")).map((c) => `${c.method} ${new URL(c.url).pathname}`), [
    "POST /api/session",
    `GET /api/session/${sessionId}`,
    `POST /api/session/${sessionId}/wake`,
    `POST /api/session/${sessionId}/instruction`,
    `POST /api/session/${sessionId}/view-ticket`,
  ]);
});

test("record wakes then starts and stops a redacted HAR receipt", async () => {
  const paths: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (path === "/internal/capabilities") return jsonResponse(200, { token: "cap_live", expiresAt: Date.now() + 60_000 });
    paths.push(`${init?.method ?? "GET"} ${path}`);
    if (path.endsWith("/wake")) return jsonResponse(200, { success: true });
    if (path.endsWith("/network-har/start")) return jsonResponse(200, { success: true, record: { recordId: sessionId, status: "recording", startedAt: 1 } });
    if (path.endsWith("/network-har/stop")) {
      return jsonResponse(200, {
        success: true,
        receipt: { receiptId: "123e4567-e89b-42d3-a456-426614174011", recordId: "123e4567-e89b-42d3-a456-426614174010", createdAt: 1, entryCount: 0, entries: [] },
      });
    }
    throw new Error(String(url));
  }) as any;
  const provider = createAgentCastWorkProvider(ctxWith(fetchImpl));
  const res = await provider.fns.record({ sessionId }) as any;
  assert.equal(res.ok, true);
  assert.equal(res.receipt.entryCount, 0);
  assert.deepEqual(paths, [
    `POST /api/session/${sessionId}/wake`,
    `POST /api/session/${sessionId}/network-har/start`,
    `POST /api/session/${sessionId}/network-har/stop`,
  ]);
});

test("open stops the session when a later step fails, so capacity is not leaked", async () => {
  const calls: Array<{ path: string; method: string }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    calls.push({ path, method: init?.method ?? "GET" });
    if (path === "/internal/capabilities") return jsonResponse(200, { token: "cap_live" });
    if (path === "/api/session" && init?.method === "POST") return jsonResponse(200, { success: true, data: { sessionId } });
    if (path === `/api/session/${sessionId}`) return jsonResponse(200, { status: "ready" });
    if (path.endsWith("/wake")) return jsonResponse(200, { ok: true });
    if (path.endsWith("/instruction")) return jsonResponse(500, { error: "instruction exploded" });
    if (path.endsWith("/stop")) return jsonResponse(200, { ok: true });
    return jsonResponse(404, { error: `unexpected ${path}` });
  }) as any;

  const provider = createAgentCastWorkProvider(ctxWith(fetchImpl));
  await assert.rejects(() => provider.fns.open({ instruction: "goto https://agentcast.dev" }), /instruction exploded/);

  const stopped = calls.filter((c) => c.path.endsWith("/stop") && c.method === "POST");
  assert.equal(stopped.length, 1, "a session created then abandoned must be stopped");
});

test("a slow browser start is reported as a timeout, not a mystery", async () => {
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (path === "/internal/capabilities") return jsonResponse(200, { token: "cap_live" });
    if (path === "/api/session" && init?.method === "POST") return jsonResponse(200, { success: true, data: { sessionId } });
    if (path === `/api/session/${sessionId}`) return jsonResponse(200, { status: "starting" });
    if (path.endsWith("/stop")) return jsonResponse(200, { ok: true });
    return jsonResponse(404, { error: `unexpected ${path}` });
  }) as any;
  const provider = createAgentCastWorkProvider(ctxWith(fetchImpl, { AGENTCAST_READY_ATTEMPTS: 3, AGENTCAST_READY_INTERVAL_MS: 0 }));
  await assert.rejects(() => provider.fns.open({ instruction: "x" }), /was not ready after \d+s/);
});

test("open takes over a stale profile instead of failing with 409", async () => {
  const bodies: string[] = [];
  let created = 0;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (path === "/internal/capabilities") return jsonResponse(200, { token: "cap_live" });
    if (path === "/api/session" && init?.method === "POST") {
      const body = String(init.body ?? "");
      bodies.push(body);
      if (!body.includes("takeover")) return jsonResponse(409, { success: false, error: "Profile is already active" });
      created += 1;
      return jsonResponse(200, { success: true, data: { sessionId } });
    }
    if (path === `/api/session/${sessionId}`) return jsonResponse(200, { status: "ready" });
    if (path.endsWith("/wake")) return jsonResponse(200, { ok: true });
    if (path.endsWith("/instruction")) return jsonResponse(200, { ok: true });
    if (path.endsWith("/view-ticket")) return jsonResponse(200, { ticketUrl: "https://api.agentcast.dev/ticket/t" });
    if (path.endsWith("/stop")) return jsonResponse(200, { ok: true });
    return jsonResponse(404, { error: `unexpected ${path}` });
  }) as any;

  const provider = createAgentCastWorkProvider(ctxWith(fetchImpl));
  const res = await provider.fns.open({ instruction: "goto https://example.com" });
  assert.equal(res.ok, true);
  assert.equal(created, 1, "the retry must create exactly one session");
  assert.equal(bodies.length, 2, "the first attempt is plain, the second takes over");
  assert.ok(!bodies[0].includes("takeover"), "the first attempt must not force a takeover");
  assert.ok(bodies[1].includes("takeover"), "the retry must ask for a takeover");
});
