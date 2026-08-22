import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { AGENTCAST_WORK_METHODS, createAgentCastWorkProvider } from "./agentcast-tools";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const sessionId = "123e4567-e89b-42d3-a456-426614174000";

function ctxWith(fetchImpl: typeof fetch, env: Record<string, unknown> = {}) {
  globalThis.fetch = fetchImpl;
  return {
    env: { AGENTCAST_CONTROL_TOKEN: "tok_test", ...env },
    identity: { email: "owner@example.com" },
  } as any;
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("catalog advertises open, instruct, status, record, stop", () => {
  assert.deepEqual(AGENTCAST_WORK_METHODS.map((m) => m.name).sort(), ["instruct", "open", "record", "status", "stop"]);
});

test("configuration fails closed without a control token", async () => {
  const provider = createAgentCastWorkProvider(ctxWith((async () => jsonResponse(200, {})) as any, { AGENTCAST_CONTROL_TOKEN: "" }));
  await assert.rejects(() => provider.fns.open({ instruction: "goto https://agentcast.dev" }), /not configured/);
});

test("open rejects workers.dev origins", async () => {
  const provider = createAgentCastWorkProvider(ctxWith((async () => jsonResponse(200, {})) as any, {
    AGENTCAST_URL: "https://agentcast-worker.coy.workers.dev",
  }));
  await assert.rejects(() => provider.fns.open({ instruction: "goto https://agentcast.dev" }), /workers.dev/);
});

test("open runs create, poll, wake, instruct, and ticket over HTTPS", async () => {
  const calls: Array<{ url: string; method: string; auth: string | undefined }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(url), method: init?.method ?? "GET", auth: headers.authorization });
    const path = new URL(String(url)).pathname;
    if (path === "/api/session" && init?.method === "POST") return jsonResponse(200, { success: true, data: { sessionId } });
    if (path === `/api/session/${sessionId}` && (init?.method ?? "GET") === "GET") {
      return jsonResponse(200, { id: sessionId, status: "ready" });
    }
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
  assert.deepEqual(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`), [
    "POST /api/session",
    `GET /api/session/${sessionId}`,
    `POST /api/session/${sessionId}/wake`,
    `POST /api/session/${sessionId}/instruction`,
    `POST /api/session/${sessionId}/view-ticket`,
  ]);
  assert.ok(calls.every((c) => c.auth === "Bearer tok_test"));
  assert.ok(calls.every((c) => c.url.startsWith("https://api.agentcast.dev/")));
});

test("record wakes then starts and stops a redacted HAR receipt", async () => {
  const paths: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    paths.push(`${init?.method ?? "GET"} ${new URL(String(url)).pathname}`);
    if (String(url).endsWith("/wake")) return jsonResponse(200, { success: true });
    if (String(url).endsWith("/network-har/start")) return jsonResponse(200, { success: true, record: { recordId: sessionId, status: "recording", startedAt: 1 } });
    if (String(url).endsWith("/network-har/stop")) {
      return jsonResponse(200, {
        success: true,
        receipt: {
          receiptId: "123e4567-e89b-42d3-a456-426614174011",
          recordId: "123e4567-e89b-42d3-a456-426614174010",
          createdAt: 1,
          entryCount: 0,
          entries: [],
        },
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
