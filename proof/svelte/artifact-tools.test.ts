import assert from "node:assert/strict";
import test from "node:test";
import { ArtifactToolRegistry, validateArgs, MAX_TOOLS_PER_ARTIFACT, MAX_ARTIFACT_VERBS_TOTAL, INNER_INVOKE_TIMEOUT_MS, type ArtifactHostBridge } from "./artifact-tools";

// A fake host: windows are opaque tokens; we map token -> artifactId and capture posts.
function makeHost() {
  const winToId = new Map<unknown, string>();
  const posts: Array<{ artifactId: string; frame: any }> = [];
  const liveIds = new Set<string>();
  const host: ArtifactHostBridge = {
    artifactIdForWindow: (source) => winToId.get(source) ?? null,
    postToArtifact: (artifactId, frame) => { if (!liveIds.has(artifactId)) return false; posts.push({ artifactId, frame }); return true; },
  };
  return { host, winToId, posts, liveIds };
}
function bind(h: ReturnType<typeof makeHost>, win: unknown, id: string) { h.winToId.set(win, id); h.liveIds.add(id); }

test("register: id is derived from the source window, not the message (G1)", () => {
  const h = makeHost(); const reg = new ArtifactToolRegistry(h.host);
  const winA = {}; bind(h, winA, "art-A");
  const r = reg.register(winA, [{ name: "setFilter", description: "filter", inputSchema: { status: "string" } }]);
  assert.equal(r.ok, true);
  assert.equal(r.artifactId, "art-A");
  assert.deepEqual(r.registered, ["setFilter"]);
});

test("A1: a spoofed source (not a live artifact window) is rejected", () => {
  const h = makeHost(); const reg = new ArtifactToolRegistry(h.host);
  const r = reg.register({}, [{ name: "evil", description: "x" }]);
  assert.equal(r.ok, false);
  assert.equal(r.error, "artifact_source_invalid");
});

test("A2: artifact B cannot claim or invoke artifact A's namespace", async () => {
  const h = makeHost(); const reg = new ArtifactToolRegistry(h.host);
  const winA = {}, winB = {}; bind(h, winA, "art-A"); bind(h, winB, "art-B");
  reg.register(winA, [{ name: "readState", description: "a", inputSchema: {} }]);
  // B registers its own — gets art-B (its own window's id), cannot become art-A.
  const rb = reg.register(winB, [{ name: "readState", description: "b", inputSchema: {} }]);
  assert.equal(rb.artifactId, "art-B");
  // An invoke to art-A routes ONLY to A's window; B's window never receives it.
  h.liveIds.add("art-A");
  const p = reg.invoke("art-A", "readState", {});
  reg.resolveResult(h.posts.at(-1)!.frame.callId, true, { owner: "A" });
  assert.deepEqual(await p, { owner: "A" });
  assert.equal(h.posts.at(-1)!.artifactId, "art-A", "invoke posted only to A's window");
});

test("A3: unregister mid-flight rejects pending invokes with artifact_gone", async () => {
  const h = makeHost(); const reg = new ArtifactToolRegistry(h.host);
  const winA = {}; bind(h, winA, "art-A");
  reg.register(winA, [{ name: "slow", description: "s", inputSchema: {} }]);
  const p = reg.invoke("art-A", "slow", {});
  reg.unregister("art-A"); // iframe unloaded before replying
  await assert.rejects(p, /artifact_gone/);
});

test("A4: inner invoke timeout fires (and is strictly < outer 10s DO timeout)", async () => {
  assert.ok(INNER_INVOKE_TIMEOUT_MS < 10000, "inner timeout must be < outer 10s");
  const h = makeHost(); const reg = new ArtifactToolRegistry(h.host);
  const winA = {}; bind(h, winA, "art-A");
  reg.register(winA, [{ name: "hang", description: "h", inputSchema: {} }]);
  // Use a fake timer host so the test doesn't wait 6s.
  let fired: (() => void) | null = null;
  const fastHost: ArtifactHostBridge = { ...h.host, setTimer: (fn) => { fired = fn; return 1; }, clearTimer: () => {} };
  const reg2 = new ArtifactToolRegistry(fastHost);
  reg2.register(winA, [{ name: "hang", description: "h", inputSchema: {} }]);
  const p = reg2.invoke("art-A", "hang", {});
  fired!(); // simulate the inner timeout elapsing
  await assert.rejects(p, /artifact_invoke_timeout/);
});

test("A5: args that violate the registered schema are rejected, never forwarded", async () => {
  const h = makeHost(); const reg = new ArtifactToolRegistry(h.host);
  const winA = {}; bind(h, winA, "art-A");
  reg.register(winA, [{ name: "setFilter", description: "f", inputSchema: { status: "string" } }]);
  await assert.rejects(reg.invoke("art-A", "setFilter", { status: 123 as any }), /artifact_bad_args/);
  await assert.rejects(reg.invoke("art-A", "setFilter", { nope: "x" } as any), /artifact_bad_args/);
  assert.equal(h.posts.length, 0, "no invoke posted for bad args");
});

test("G2 nav-frozen: new invokes are refused with artifact_unavailable", async () => {
  const h = makeHost(); const reg = new ArtifactToolRegistry(h.host);
  const winA = {}; bind(h, winA, "art-A");
  reg.register(winA, [{ name: "x", description: "x", inputSchema: {} }]);
  reg.setNavFrozen(true);
  await assert.rejects(reg.invoke("art-A", "x", {}), /artifact_unavailable/);
});

test("G4: per-artifact tool cap enforced", () => {
  const h = makeHost(); const reg = new ArtifactToolRegistry(h.host);
  const winA = {}; bind(h, winA, "art-A");
  const tooMany = Array.from({ length: MAX_TOOLS_PER_ARTIFACT + 1 }, (_, i) => ({ name: `t${i}`, description: "d", inputSchema: {} }));
  const r = reg.register(winA, tooMany);
  assert.equal(r.ok, false);
  assert.equal(r.error, "artifact_too_many_tools");
});

test("G4: global verb cap enforced across artifacts", () => {
  const h = makeHost(); const reg = new ArtifactToolRegistry(h.host);
  // 4 artifacts * 8 tools = 32 (the cap); a 5th artifact's tools overflow.
  for (let a = 0; a < 4; a++) {
    const w = {}; bind(h, w, `art-${a}`);
    const tools = Array.from({ length: 8 }, (_, i) => ({ name: `t${i}`, description: "d", inputSchema: {} }));
    assert.equal(reg.register(w, tools).ok, true);
  }
  const w5 = {}; bind(h, w5, "art-5");
  const r = reg.register(w5, [{ name: "one", description: "d", inputSchema: {} }]);
  assert.equal(r.ok, false);
  assert.equal(r.error, "artifact_registry_full");
});

test("G4: listTools returns the discoverable catalog (not injected into work_search)", () => {
  const h = makeHost(); const reg = new ArtifactToolRegistry(h.host);
  const winA = {}; bind(h, winA, "art-A");
  reg.register(winA, [{ name: "setFilter", description: "Filter jobs", inputSchema: { status: "string" } }]);
  assert.deepEqual(reg.listTools(), [{ artifactId: "art-A", name: "setFilter", description: "Filter jobs" }]);
});

test("happy path: register -> invoke -> iframe replies -> result resolves", async () => {
  const h = makeHost(); const reg = new ArtifactToolRegistry(h.host);
  const winA = {}; bind(h, winA, "art-A");
  reg.register(winA, [{ name: "setFilter", description: "f", inputSchema: { status: "string" } }]);
  const p = reg.invoke("art-A", "setFilter", { status: "failed" });
  const frame = h.posts.at(-1)!.frame;
  assert.equal(frame.type, "my-ax:artifact-invoke");
  assert.equal(frame.name, "setFilter");
  assert.deepEqual(frame.args, { status: "failed" });
  reg.resolveResult(frame.callId, true, { shown: 3 });
  assert.deepEqual(await p, { shown: 3 });
});

test("validateArgs: fail-closed when no schema but args provided", () => {
  assert.equal(validateArgs({ x: 1 }, undefined).ok, false);
  assert.equal(validateArgs({}, undefined).ok, true);
});

test("validateArgs: optional keys may be omitted, required may not", () => {
  const schema = { a: "string", b: "number?" } as const;
  assert.equal(validateArgs({ a: "x" }, schema).ok, true);
  assert.equal(validateArgs({ b: 2 }, schema as any).ok, false); // missing required a
});
