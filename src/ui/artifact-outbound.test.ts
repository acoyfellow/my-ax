import assert from "node:assert/strict";
import test from "node:test";
import { ArtifactOutboundBridge, MAX_OUTBOUND_CALLS_PER_MINUTE, OUTBOUND_ALLOWLIST, boundOutboundArgs, isOutboundVerbAllowed } from "./artifact-outbound";

function harness(options: { runVerb?: (verb: string, args: Record<string, unknown>) => Promise<unknown>; windowId?: string | null } = {}) {
  const posted: Array<Record<string, unknown>> = [];
  const bridge = new ArtifactOutboundBridge({
    artifactIdForWindow: () => (options.windowId === undefined ? "art-1" : options.windowId),
    runVerb: options.runVerb ?? (async () => ({ ok: true })),
    postToArtifact: (_id, frame) => { posted.push(frame as Record<string, unknown>); return true; },
  });
  return { bridge, posted };
}

test("an allowlisted verb reaches the host and its result is returned", async () => {
  const seen: string[] = [];
  const { bridge, posted } = harness({ runVerb: async (verb) => { seen.push(verb); return [{ id: "s1" }]; } });
  await bridge.handleCall({}, { type: "my-ax:host-invoke", callId: "c1", verb: "listSessions" });
  assert.deepEqual(seen, ["listSessions"]);
  assert.equal(posted[0]?.ok, true);
  assert.deepEqual(posted[0]?.result, [{ id: "s1" }]);
});

test("a verb outside the allowlist is refused and never reaches the host", async () => {
  let ran = false;
  const { bridge, posted } = harness({ runVerb: async () => { ran = true; return null; } });
  await bridge.handleCall({}, { type: "my-ax:host-invoke", callId: "c2", verb: "setViewportDebug" });
  assert.equal(ran, false);
  assert.equal(posted[0]?.ok, false);
  assert.equal(posted[0]?.error, "host_verb_not_allowed");
});

test("an unknown verb name is refused", async () => {
  const { bridge, posted } = harness();
  await bridge.handleCall({}, { type: "my-ax:host-invoke", callId: "c3", verb: "rm_rf" });
  assert.equal(posted[0]?.error, "host_verb_not_allowed");
});

test("a call from a window that is not a live artifact is dropped with no reply", async () => {
  const { bridge, posted } = harness({ windowId: null });
  const handled = await bridge.handleCall({}, { type: "my-ax:host-invoke", callId: "c4", verb: "listSessions" });
  assert.equal(handled, false);
  assert.equal(posted.length, 0);
});

test("a frozen bridge refuses every call", async () => {
  const { bridge, posted } = harness();
  bridge.setNavFrozen(true);
  await bridge.handleCall({}, { type: "my-ax:host-invoke", callId: "c5", verb: "listSessions" });
  assert.equal(posted[0]?.error, "host_unavailable");
});

test("a host error becomes a failed reply, not a thrown frame", async () => {
  const { bridge, posted } = harness({ runVerb: async () => { throw new Error("session_missing"); } });
  await bridge.handleCall({}, { type: "my-ax:host-invoke", callId: "c6", verb: "switchSession", args: { sessionId: "x" } });
  assert.equal(posted[0]?.ok, false);
  assert.equal(posted[0]?.error, "session_missing");
});

test("calls beyond the per-minute budget are rate limited", async () => {
  const { bridge, posted } = harness();
  for (let i = 0; i <= MAX_OUTBOUND_CALLS_PER_MINUTE; i += 1) {
    await bridge.handleCall({}, { type: "my-ax:host-invoke", callId: `c-${i}`, verb: "readVersion" });
  }
  assert.equal(posted.at(-1)?.error, "host_rate_limited");
});

test("a non-invoke frame is ignored", async () => {
  const { bridge, posted } = harness();
  assert.equal(await bridge.handleCall({}, { type: "my-ax:artifact-register" }), false);
  assert.equal(posted.length, 0);
});

test("the allowlist keeps read verbs and excludes debug verbs", () => {
  assert.equal(isOutboundVerbAllowed("listSessions"), true);
  assert.equal(isOutboundVerbAllowed("deskWrite"), true);
  assert.equal(isOutboundVerbAllowed("setViewportDebug"), false);
  assert.equal(isOutboundVerbAllowed("invokeArtifactTool"), false);
});

test("args are bounded: objects, arrays, and long strings are refused", () => {
  assert.equal(boundOutboundArgs({ a: 1 }).ok, true);
  assert.equal(boundOutboundArgs({ nested: { a: 1 } }).ok, false);
  assert.equal(boundOutboundArgs({ big: "x".repeat(4001) }).ok, false);
  assert.equal(boundOutboundArgs([1, 2]).ok, false);
  assert.equal(boundOutboundArgs({ "bad key": 1 }).ok, false);
});

test("every allowlisted verb exists in the page verb catalog", async () => {
  const { PAGE_VERBS } = await import("./page-registry");
  const known = new Set(PAGE_VERBS.map((v) => v.name));
  const missing = OUTBOUND_ALLOWLIST.filter((name) => !known.has(name));
  assert.deepEqual(missing, [], `allowlist names verbs that do not exist: ${missing.join(", ")}`);
});
