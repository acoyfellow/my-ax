import assert from "node:assert/strict";
import test from "node:test";
import { parseSendAndWaitArgs, sendAndWait, type SendAndWaitEntry } from "./send-and-wait";

function fakeSession(script: { finishAfterPolls: number; reply: string }) {
  let clock = 0;
  let polls = 0;
  const injected: string[] = [];
  const entries: SendAndWaitEntry[] = [{ id: 7, role: "assistant", content: "old reply" }];
  const deps = {
    latestEntryId: async () => entries.at(-1)?.id ?? 0,
    inject: async (content: string) => {
      injected.push(content);
      entries.push({ id: 8, role: "user", content });
    },
    isRunning: async () => {
      polls += 1;
      if (polls === script.finishAfterPolls) entries.push({ id: 9, role: "assistant", content: script.reply });
      return polls < script.finishAfterPolls;
    },
    entriesAfter: async (id: number) => entries.filter((entry) => entry.id > id),
    sleep: async (ms: number) => { clock += ms; },
    now: () => clock,
  };
  return { deps, injected };
}

test("send_and_wait injects the turn and returns only the new assistant text once the run ends", async () => {
  const { deps, injected } = fakeSession({ finishAfterPolls: 3, reply: "hello owner" });
  const result = await sendAndWait({ sessionId: "s1", content: "hi", timeoutMs: 10_000, pollMs: 100 }, deps);
  assert.deepEqual(injected, ["hi"]);
  assert.equal(result.done, true);
  assert.equal(result.timedOut, false);
  assert.equal(result.assistantText, "hello owner");
});

test("send_and_wait reports a timeout instead of hanging", async () => {
  const { deps } = fakeSession({ finishAfterPolls: 1000, reply: "late" });
  const result = await sendAndWait({ sessionId: "s1", content: "hi", timeoutMs: 500, pollMs: 100 }, deps);
  assert.equal(result.done, false);
  assert.equal(result.timedOut, true);
  assert.equal(result.assistantText, "");
});

test("send_and_wait refuses to run without an explicit chat id", () => {
  assert.throws(() => parseSendAndWaitArgs({ content: "hi" }), /sessionId is required/);
  assert.throws(() => parseSendAndWaitArgs({ sessionId: "  ", content: "hi" }), /sessionId is required/);
  assert.equal(parseSendAndWaitArgs({ sessionId: "s1", content: "hi", timeoutMs: 1e9 }).timeoutMs, 600_000);
});
