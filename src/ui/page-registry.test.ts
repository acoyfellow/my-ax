import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { handlePageCall, PAGE_VERBS, pageVerbCatalog } from "./page-registry";

// Minimal DOM/window/fetch shims so the pure verb logic is unit-testable in
// node without a browser. Each test installs exactly what its verb touches.
function installGlobals(opts: {
  fetchJson?: (url: string) => unknown;
  fetchResponse?: { status?: number; headers?: Record<string, string>; json?: unknown };
  events?: string[];
  msgNodes?: Array<{ user: boolean; text: string; ts?: string }>;
  viewport?: { innerWidth: number; innerHeight: number; visualHeight: number; dvh: number; appViewportBottom: number | null; safeAreaBottom?: number };
}) {
  const events = opts.events ?? [];
  const vp = opts.viewport;
  (globalThis as any).window = {
    dispatchEvent: (e: any) => { events.push(e.type); return true; },
    addEventListener: () => {},
    removeEventListener: () => {},
    ...(vp ? {
      innerWidth: vp.innerWidth,
      innerHeight: vp.innerHeight,
      devicePixelRatio: 3,
      visualViewport: { width: vp.innerWidth, height: vp.visualHeight, offsetTop: 0, scale: 1 },
    } : {}),
  };
  if (vp) (globalThis as any).getComputedStyle = () => ({ height: `${vp.safeAreaBottom ?? 0}px` });
  (globalThis as any).window.matchMedia = () => ({ matches: false });
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  (globalThis as any).CustomEvent = class { type: string; detail: unknown; constructor(t: string, i?: any) { this.type = t; this.detail = i?.detail; } };
  (globalThis as any).Event = class { type: string; constructor(t: string) { this.type = t; } };
  (globalThis as any).queueMicrotask = (fn: () => void) => fn();
  (globalThis as any).document = {
    documentElement: { clientHeight: vp?.dvh ?? 0 },
    body: { appendChild: () => {} },
    createElement: () => ({ style: {}, remove: () => {} }),
    querySelector: (sel: string) => (sel === ".app-viewport" && vp && vp.appViewportBottom !== null)
      ? { getBoundingClientRect: () => ({ top: 0, left: 0, width: vp.innerWidth, height: vp.appViewportBottom!, bottom: vp.appViewportBottom! }) }
      : null,
    querySelectorAll: () => (opts.msgNodes ?? []).map((n) => ({
      classList: { contains: (c: string) => (c === "msg-user" ? n.user : false) },
      querySelector: () => ({ textContent: n.text }),
      textContent: n.text,
      getAttribute: () => n.ts ?? null,
    })),
  };
  (globalThis as any).fetch = async (url: string) => {
    if (opts.fetchResponse) {
      const headers = opts.fetchResponse.headers ?? {};
      return {
        ok: (opts.fetchResponse.status ?? 200) < 400,
        status: opts.fetchResponse.status ?? 200,
        headers: { get: (name: string) => headers[name] ?? headers[name.toLowerCase()] ?? null },
        json: async () => opts.fetchResponse?.json ?? {},
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => (opts.fetchJson ? opts.fetchJson(url) : {}),
    };
  };
  return events;
}

beforeEach(() => {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).fetch;
  delete (globalThis as any).getComputedStyle;
  delete (globalThis as any).localStorage;
});

test("catalog exposes the v1 verb set with resolution metadata", () => {
  const names = pageVerbCatalog().map((v) => v.name).sort();
  assert.deepEqual(names, ["invokeArtifactTool", "listArtifactTools", "listSessions", "navigate", "notify", "openAttention", "openDesk", "openSessions", "openSettings", "readHealth", "readTranscriptTail", "readVersion", "readViewport", "reload", "setViewportDebug", "switchSession"]);
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

test("readVersion compares client boot id to /api/version without hitting /api/system", async () => {
  installGlobals({ fetchResponse: { status: 200, headers: { "X-My-Ax-Version": "new", "X-My-Ax-Version-Timestamp": "t1" } } });
  (globalThis as any).window.__MY_AX_DEPLOY__ = { id: "old", timestamp: "t0" };
  const { frame } = await handlePageCall({ type: "page_call", requestId: "rv", verb: "readVersion" });
  assert.equal(frame.ok, true);
  const r = frame.result as Record<string, unknown>;
  assert.equal(r.clientId, "old");
  assert.equal(r.deployedId, "new");
  assert.equal(r.fresh, false);
  assert.equal(r.stale, true);
});

test("reload dispatches my-ax:reload after the result", async () => {
  const events: string[] = [];
  installGlobals({ events });
  const { frame, after } = await handlePageCall({ type: "page_call", requestId: "rl", verb: "reload" });
  assert.equal(frame.ok, true);
  assert.deepEqual(events, []);
  after?.();
  assert.ok(events.includes("my-ax:reload"));
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

test("readViewport returns live top-document metrics including a numeric gapBelow", async () => {
  installGlobals({ viewport: { innerWidth: 390, innerHeight: 844, visualHeight: 844, dvh: 810, appViewportBottom: 844, safeAreaBottom: 34 } });
  const { frame } = await handlePageCall({ type: "page_call", requestId: "rvp1", verb: "readViewport" });
  assert.equal(frame.ok, true);
  const r = frame.result as Record<string, unknown>;
  assert.equal(r.innerWidth, 390);
  assert.equal(r.innerHeight, 844);
  assert.equal(r.visualHeight, 844);
  assert.equal(r.dvh, 810);
  assert.equal(r.safeAreaBottom, 34);
  assert.equal(r.devicePixelRatio, 3);
  assert.deepEqual(r.appViewportRect, { top: 0, left: 0, width: 390, height: 844, bottom: 844 });
  assert.equal(r.gapBelow, 0);
});

test("readViewport reports a positive gapBelow when the frame stops short (the bug it diagnoses)", async () => {
  installGlobals({ viewport: { innerWidth: 390, innerHeight: 844, visualHeight: 844, dvh: 810, appViewportBottom: 810 } });
  const { frame } = await handlePageCall({ type: "page_call", requestId: "rvp2", verb: "readViewport" });
  assert.equal(frame.ok, true);
  assert.equal((frame.result as Record<string, unknown>).gapBelow, 34);
});

test("readViewport returns null appViewportRect/gapBelow when the frame is absent", async () => {
  installGlobals({ viewport: { innerWidth: 390, innerHeight: 844, visualHeight: 844, dvh: 810, appViewportBottom: null } });
  const { frame } = await handlePageCall({ type: "page_call", requestId: "rvp3", verb: "readViewport" });
  assert.equal(frame.ok, true);
  assert.equal((frame.result as Record<string, unknown>).appViewportRect, null);
  assert.equal((frame.result as Record<string, unknown>).gapBelow, null);
});

test("setViewportDebug toggles the overlay, persists the flag, and returns live metrics", async () => {
  const events = installGlobals({ viewport: { innerWidth: 390, innerHeight: 844, visualHeight: 844, dvh: 810, appViewportBottom: 810, safeAreaBottom: 34 } });
  const on = await handlePageCall({ type: "page_call", requestId: "vd1", verb: "setViewportDebug", args: { on: true } });
  assert.equal(on.frame.ok, true);
  assert.equal((on.frame.result as Record<string, unknown>).on, true);
  assert.equal((on.frame.result as Record<string, unknown>).gapBelow, 34);
  assert.equal((globalThis as any).localStorage.getItem("my-ax-vpdebug"), "1");
  assert.ok(events.includes("my-ax:vpdebug"));
  const off = await handlePageCall({ type: "page_call", requestId: "vd2", verb: "setViewportDebug", args: { on: false } });
  assert.equal((off.frame.result as Record<string, unknown>).on, false);
  assert.equal((globalThis as any).localStorage.getItem("my-ax-vpdebug"), null);
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

test("openSettings / openAttention / openSessions / openDesk dispatch their window events synchronously", async () => {
  const events = installGlobals({});
  await handlePageCall({ type: "page_call", requestId: "r6", verb: "openSettings", args: { section: "connections" } });
  await handlePageCall({ type: "page_call", requestId: "r7", verb: "openAttention" });
  await handlePageCall({ type: "page_call", requestId: "r8", verb: "openSessions" });
  await handlePageCall({ type: "page_call", requestId: "r9", verb: "openDesk" });
  assert.deepEqual(events, ["my-ax:settings-open", "my-ax:attention-open", "my-ax:sessions-open", "my-ax:desk-open"]);
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
