import test from "node:test";
import assert from "node:assert/strict";
import { classifyLookup, isOfflineFailure, planResume } from "./bootstrap-resume";

test("a fetch that never reached the server is recognised as offline", () => {
  assert.equal(isOfflineFailure(new TypeError("Failed to fetch")), true);
  assert.equal(isOfflineFailure(new TypeError("NetworkError when attempting to fetch resource.")), true);
  assert.equal(isOfflineFailure(new Error("Load failed")), true);
  assert.equal(isOfflineFailure(new Error("HTTP 500")), false);
});

test("an offline bootstrap keeps the cached session instead of discarding it", () => {
  const plan = planResume({ cached: "session-abc", outcome: classifyLookup(new TypeError("Failed to fetch")) });
  assert.equal(plan.resumeId, "session-abc", "a network blip must not lose the conversation");
  assert.equal(plan.forgetCachedSession, false, "the cached session must survive an offline bootstrap");
});

test("an offline bootstrap with no cached session explains itself without blaming the conversation", () => {
  const plan = planResume({ cached: null, outcome: classifyLookup(new TypeError("Failed to fetch")) });
  assert.equal(plan.resumeId, null);
  assert.equal(plan.forgetCachedSession, false);
  assert.match(plan.toast ?? "", /offline/i);
  assert.ok(!/failed to fetch/i.test(plan.toast ?? ""), "the owner should not be shown a raw fetch error");
});

test("a real server answer with no sessions clears the stale cached id", () => {
  const plan = planResume({ cached: "session-gone", outcome: { kind: "empty" } });
  assert.equal(plan.resumeId, null);
  assert.equal(plan.forgetCachedSession, true, "an authoritative empty answer may clear the cache");
  assert.equal(plan.toast, null);
});

test("a found session resumes and says nothing", () => {
  const plan = planResume({ cached: "stale", outcome: { kind: "found", sessionId: "session-live" } });
  assert.equal(plan.resumeId, "session-live");
  assert.equal(plan.forgetCachedSession, false);
  assert.equal(plan.toast, null);
});

test("a genuine server error still surfaces its message", () => {
  const plan = planResume({ cached: null, outcome: classifyLookup(new Error("HTTP 503")) });
  assert.match(plan.toast ?? "", /HTTP 503/);
});

test("a server error does not discard the cached session either", () => {
  const plan = planResume({ cached: "session-abc", outcome: classifyLookup(new Error("HTTP 503")) });
  assert.equal(plan.resumeId, "session-abc");
  assert.equal(plan.forgetCachedSession, false);
});
