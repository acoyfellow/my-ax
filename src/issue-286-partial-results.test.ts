import assert from "node:assert/strict";
import test from "node:test";
import { buildConversationSearchQuery } from "./conversation-search";
import { laptopBusyResult, machineBusyOutcome } from "./machinectl-output";
import { raceWorkCodeExecution, WorkCodeLogMirror, mergeWorkCodeLogs } from "./work-code-output";

test("work_code execution that never settles returns a timed-out partial outcome", async () => {
  const outcome = await raceWorkCodeExecution(new Promise(() => {}), 20);
  assert.equal(outcome.timedOut, true);
  assert.match(outcome.error ?? "", /timed out/);
});

test("work_code executor rejection is a partial outcome, not a thrown error", async () => {
  const outcome = await raceWorkCodeExecution(Promise.reject(new Error("Execution timed out")), 1_000);
  assert.equal(outcome.timedOut, true);
  assert.equal(outcome.error, "Execution timed out");
});

test("work_code in-sandbox timeout keeps sandbox logs and flags timedOut", async () => {
  const outcome = await raceWorkCodeExecution(Promise.resolve({ result: undefined, error: "Execution timed out", logs: ["step 1"] }), 1_000);
  assert.equal(outcome.timedOut, true);
  assert.deepEqual(outcome.logs, ["step 1"]);
});

test("mirrored logs survive when the sandbox returns none", async () => {
  const mirror = new WorkCodeLogMirror();
  await mirror.record({ line: "gathered 3 files" });
  assert.deepEqual(mergeWorkCodeLogs(undefined, mirror.logs), ["gathered 3 files"]);
  assert.deepEqual(mergeWorkCodeLogs(["sandbox"], mirror.logs), ["sandbox"]);
  const forwarded: string[] = [];
  const bridge = { work_code_log: async (input: { line: string }) => { forwarded.push(input.line); } };
  const noop = (..._args: unknown[]) => {};
  const console = { log: noop, warn: noop, error: noop };
  new Function("bridge", "console", WorkCodeLogMirror.prelude("bridge", "work_code_log"))(bridge, console);
  console.log("a", 1);
  console.warn("b");
  assert.deepEqual(forwarded, ["a 1", "[warn] b"]);
});

test("laptop busy is a structured retryable result", () => {
  const busy = laptopBusyResult();
  assert.equal(busy.busy, true);
  assert.ok(busy.retryAfterMs > 0);
  assert.deepEqual(machineBusyOutcome(busy), { busy: true, retryAfterMs: busy.retryAfterMs });
  assert.equal(machineBusyOutcome({ busy: undefined }), null);
  assert.deepEqual(machineBusyOutcome({ busy: true, retryAfterMs: -1 }), { busy: true, retryAfterMs: 2_000 });
});

test("search_conversations supports recent sort and date range", () => {
  const built = buildConversationSearchQuery("deploy bug", "Owner@Example.com", { sort: "recent", since: "2025-01-01", until: "2025-02-01T00:00:00Z", limit: 5 });
  assert.ok(built);
  assert.match(built.sql, /e\.ts >= \? AND e\.ts <= \?/);
  assert.match(built.sql, /ORDER BY e\.ts DESC LIMIT \?$/);
  assert.deepEqual(built.params, ['"deploy" "bug"', "owner@example.com", "2025-01-01T00:00:00.000Z", "2025-02-01T00:00:00.000Z", 5]);
});

test("search_conversations defaults to relevance and ignores invalid dates", () => {
  const built = buildConversationSearchQuery("deploy", "o@example.com", { since: "not-a-date" });
  assert.ok(built);
  assert.doesNotMatch(built.sql, /e\.ts >=/);
  assert.match(built.sql, /ORDER BY bm25\(conversation_entries_fts\)/);
  assert.equal(buildConversationSearchQuery("!!!", "o@example.com"), null);
});
