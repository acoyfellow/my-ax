import assert from "node:assert/strict";
import test from "node:test";
import { SessionGenerationGuard } from "./session-generation";
import { loadCurrentSessionEntries, shouldReportEmptyRestore } from "./session-history";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function response<T>(entries: T[], hasMore = false, nextCursor?: string) {
  return { ok: true, async json() { return { result: { entries, hasMore, nextCursor } }; } };
}

test("delayed empty restore A to B is stale, with no message write or error toast", async () => {
  const guard = new SessionGenerationGuard();
  let active = "A", messages = "B transcript", errors = 0;
  guard.activate(active);
  const expected = guard.capture()!;
  const pendingPage = deferred<ReturnType<typeof response<never>>>();
  const pending = loadCurrentSessionEntries({ expected, isCurrent: (e) => guard.isCurrent(e, active), maxPages: 20, fetchPage: () => pendingPage.promise });
  active = "B"; guard.activate(active); pendingPage.resolve(response([]));
  const result = await pending;
  if (result.outcome === "current") messages = "A transcript";
  const outcome = result.outcome === "stale" ? "stale" : result.entries.length ? "restored" : "empty";
  if (shouldReportEmptyRestore(outcome)) errors++;
  assert.deepEqual({ outcome, messages, errors }, { outcome: "stale", messages: "B transcript", errors: 0 });
});

test("genuine current empty restore reports the recoverable-transcript error", async () => {
  const guard = new SessionGenerationGuard(); guard.activate("A");
  const result = await loadCurrentSessionEntries({ expected: guard.capture()!, isCurrent: (e) => guard.isCurrent(e, "A"), maxPages: 20, fetchPage: async () => response([]) });
  assert.equal(result.outcome, "current");
  assert.equal(shouldReportEmptyRestore(result.entries.length ? "restored" : "empty"), true);
});

test("real loader paginates and compacted restore call-through remains generation guarded", async () => {
  const guard = new SessionGenerationGuard(); let active = "A", calls = 0, writes = 0;
  guard.activate(active); const expected = guard.capture()!;
  const second = deferred<ReturnType<typeof response<{ role: string }>>>();
  const secondStarted = deferred<void>();
  const compacted = loadCurrentSessionEntries({ expected, isCurrent: (e) => guard.isCurrent(e, active), maxPages: 20,
    fetchPage: async (after) => { calls++; if (after === "0") return response([{ role: "user" }], true, "1"); secondStarted.resolve(); return second.promise; } });
  await secondStarted.promise;
  active = "B"; guard.activate(active); second.resolve(response([{ role: "user" }]));
  const result = await compacted;
  if (result.outcome === "current" && result.entries.filter((e) => e.role === "user").length > 1 && guard.isCurrent(expected, active)) writes++;
  assert.deepEqual({ outcome: result.outcome, calls, writes }, { outcome: "stale", calls: 2, writes: 0 });
});

test("timestamp hydration cannot mutate messages after JSON decoding changes generation", async () => {
  const guard = new SessionGenerationGuard(); let active = "A", timestamp = 7;
  guard.activate(active); const expected = guard.capture()!;
  const result = await loadCurrentSessionEntries({ expected, isCurrent: (e) => guard.isCurrent(e, active), maxPages: 10,
    fetchPage: async () => ({ ok: true, async json() { active = "B"; guard.activate(active); return { result: { entries: [{ createdAt: 99 }] } }; } }) });
  if (result.outcome === "current") timestamp = result.entries[0].createdAt;
  assert.deepEqual({ outcome: result.outcome, timestamp }, { outcome: "stale", timestamp: 7 });
});

test("same-session new generation invalidates old work", async () => {
  const guard = new SessionGenerationGuard(); guard.activate("A"); const stale = guard.capture()!;
  guard.activate("A");
  const result = await loadCurrentSessionEntries({ expected: stale, isCurrent: (e) => guard.isCurrent(e, "A"), maxPages: 1, fetchPage: async () => response([]) });
  assert.equal(result.outcome, "stale");
});
