import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { handlePageCall, PAGE_VERBS, pageVerbCatalog } from "./page-registry";

// Minimal DOM/window/fetch shims so the pure verb logic is unit-testable in
// node without a browser. Each test installs exactly what its verb touches.
function installGlobals(opts: {
  fetchJson?: (url: string) => unknown;
  events?: string[];
  msgNodes?: Array<{ user: boolean; text: string; ts?: string }>;
}) {
  const events = opts.events ?? [];
  (globalThis as any).window = {
    dispatchEvent: (e: any) => { events.push(e.type); return true; },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  (globalThis as any).CustomEvent = class { type: string; detail: unknown; constructor(t: string, i?: any) { this.type = t; this.detail = i?.detail; } };
  (globalThis as any).Event = class { type: string; constructor(t: string) { this.type = t; } };
  (globalThis as any).queueMicrotask = (fn: () => void) => fn();
  (globalThis as any).document = {
    querySelectorAll: () => (opts.msgNodes ?? []).map((n) => ({
      classList: { contains: (c: string) => (c === "msg-user" ? n.user : false) },
      querySelector: () => ({ textContent: n.text }),
      textContent: n.text,
      getAttribute: () => n.ts ?? null,
    })),
  };
  (globalThis as any).fetch = async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => (opts.fetchJson ? opts.fetchJson(url) : {}),
  });
  return events;
}

beforeEach(() => {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).fetch;
});

test("catalog exposes the v1 verb set with resolution metadata", () => {
  const names = pageVerbCatalog().map((v) => v.name).sort();
  assert.deepEqual(names, ["invokeArtifactTool", "listArtifactTools", "listSessions", "navigate", "notify", "openAttention", "openSessions", "openSettings", "readHealth", "readTranscriptTail", "switchSession"]);
  assert.equal(pageVerbCatalog().find((v) => v.name === "switchSession")?.resolution, "ack");
  assert.equal(pageVerbCatalog().find((v) => v.name === "listSessions")?.resolution, "receipt");
});

test("listSessions unwraps the REST { result: { sessions } } envelope", async () => {
  installGlobals({ fetchJson: () => ({ ok: true, command: "GET /api/sessions", result: { sessions: [
    { id: "s1", title: "One", status: "active", updated_at: "t1" },
    { id: "s2", title: null, status: "idle", updatedAt: "t2" },
  ] } }) });
  const { frame } = await handlePageCall({ type: "page_call", requestId: "r1", verb: "listSessions", args: { limit: 5 } });
  assert.equal(frame.ok, true);
  assert.deepEqual(frame.result, [
    { id: "s1", title: "One", status: "active", updatedAt: "t1" },
    { id: "s2", title: null, status: "idle", updatedAt: "t2" },
  ]);
});

test("readHealth unwraps the REST { result } envelope", async () => {
  installGlobals({ fetchJson: () => ({ ok: true, result: { region: "TEST-COLO", container: { vcpus: 4 } } }) });
  const { frame } = await handlePageCall({ type: "page_call", requestId: "r2", verb: "readHealth" });
  assert.equal(frame.ok, true);
  assert.deepEqual(frame.result, { region: "TEST-COLO", container: { vcpus: 4 } });
});

test("readTranscriptTail reads rendered rows and clamps n", async () => {
  installGlobals({ msgNodes: [ { user: true, text: "hi" }, { user: false, text: "hello there", ts: "2026" } ] });
  const { frame } = await handlePageCall({ type: "page_call", requestId: "r3", verb: "readTranscriptTail", args: { n: 999 } });
  assert.equal(frame.ok, true);
  assert.deepEqual(frame.result, [ { role: "user", text: "hi", ts: null }, { role: "assistant", text: "hello there", ts: "2026" } ]);
});

test("switchSession returns result immediately and defers the disruptive switch to after()", async () => {
  const events = installGlobals({});
  const { frame, after } = await handlePageCall({ type: "page_call", requestId: "r4", verb: "switchSession", args: { id: "target" } });
  // The reply is ready BEFORE the switch event fires — the whole point.
  assert.equal(frame.ok, true);
  assert.deepEqual(frame.result, { ok: true, id: "target" });
  assert.deepEqual(events, [], "no switch event should have been dispatched yet");
  assert.equal(typeof after, "function");
  after!();
  assert.deepEqual(events, ["my-ax:switch-session"], "after() dispatches the switch");
});

test("switchSession without id is a typed error, not a throw", async () => {
  installGlobals({});
  const { frame } = await handlePageCall({ type: "page_call", requestId: "r5", verb: "switchSession", args: {} });
  assert.equal(frame.ok, false);
  assert.match(String(frame.error), /requires \{id\}/);
});

test("openSettings / openAttention / openSessions dispatch their window events synchronously", async () => {
  const events = installGlobals({});
  await handlePageCall({ type: "page_call", requestId: "r6", verb: "openSettings", args: { section: "connections" } });
  await handlePageCall({ type: "page_call", requestId: "r7", verb: "openAttention" });
  await handlePageCall({ type: "page_call", requestId: "r8", verb: "openSessions" });
  assert.deepEqual(events, ["my-ax:settings-open", "my-ax:attention-open", "my-ax:sessions-open"]);
});

test("notify dispatches my-ax:toast with text+kind and requires text", async () => {
  const events = installGlobals({});
  const { frame } = await handlePageCall({ type: "page_call", requestId: "rn1", verb: "notify", args: { text: "hello owner", kind: "system" } });
  assert.equal(frame.ok, true);
  assert.deepEqual(events, ["my-ax:toast"]);
  const err = await handlePageCall({ type: "page_call", requestId: "rn2", verb: "notify", args: {} });
  assert.equal(err.frame.ok, false);
  assert.match(String(err.frame.error), /requires \{text\}/);
});

test("navigate replies first then dispatches my-ax:navigate in after() (disruptive)", async () => {
  const events = installGlobals({});
  const { frame, after } = await handlePageCall({ type: "page_call", requestId: "rv1", verb: "navigate", args: { target: "/?action=attention" } });
  assert.equal(frame.ok, true);
  assert.deepEqual((frame.result as any), { ok: true, target: "/?action=attention" });
  assert.deepEqual(events, [], "no navigate event before the result is flushed");
  assert.equal(typeof after, "function");
  after!();
  assert.deepEqual(events, ["my-ax:navigate"]);
  const err = await handlePageCall({ type: "page_call", requestId: "rv2", verb: "navigate", args: {} });
  assert.equal(err.frame.ok, false);
  assert.match(String(err.frame.error), /requires \{target\}/);
});

test("unknown verb resolves to a typed error frame keyed by requestId", async () => {
  installGlobals({});
  const { frame, after } = await handlePageCall({ type: "page_call", requestId: "rX", verb: "definitely-not-a-verb" });
  assert.equal(frame.ok, false);
  assert.equal(frame.requestId, "rX");
  assert.match(String(frame.error), /unknown page verb/);
  assert.equal(after, undefined);
});

test("every catalog verb is wired to a runnable implementation", () => {
  for (const v of PAGE_VERBS) assert.equal(typeof v.run, "function", `${v.name} has a run()`);
});
