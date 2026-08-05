import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPUTER_WORK_CODE_MAX_CALLS,
  COMPUTER_WORK_CODE_MAX_CONCURRENCY,
  COMPUTER_WORK_CODE_MAX_CUMULATIVE_READ_BYTES,
  COMPUTER_WORK_CODE_MAX_CUMULATIVE_WRITE_BYTES,
  applyComputerWorkBudget,
} from "./computer-work-budget";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

test("Computer work_code budget rejects calls after its per-run call limit", async () => {
  const functions = applyComputerWorkBudget({ list: async () => "ok" });
  for (let index = 0; index < COMPUTER_WORK_CODE_MAX_CALLS; index += 1) {
    assert.equal(await functions.list({}), "ok");
  }
  await assert.rejects(() => functions.list({}), /call budget/);
});

test("Computer work_code budget rejects calls beyond its concurrent limit", async () => {
  const gates = Array.from({ length: COMPUTER_WORK_CODE_MAX_CONCURRENCY }, () => deferred<string>());
  let next = 0;
  const functions = applyComputerWorkBudget({ list: async () => gates[next++].promise });
  const active = gates.map(() => functions.list({}));
  await assert.rejects(() => functions.list({}), /concurrency budget/);
  for (const gate of gates) gate.resolve("ok");
  assert.deepEqual(await Promise.all(active), Array.from({ length: COMPUTER_WORK_CODE_MAX_CONCURRENCY }, () => "ok"));
});

test("Computer work_code budget reserves cumulative read capacity for read and grep", async () => {
  const functions = applyComputerWorkBudget({ read: async () => "ok", grep: async () => "ok" });
  const reads = COMPUTER_WORK_CODE_MAX_CUMULATIVE_READ_BYTES / (32 * 1024);
  for (let index = 0; index < reads; index += 1) {
    assert.equal(await functions.read({ path: "/home/user/note.txt" }), "ok");
  }
  await assert.rejects(() => functions.read({ path: "/home/user/note.txt" }), /cumulative read budget/);
  await assert.rejects(() => functions.grep({ query: "note" }), /cumulative read budget/);
});

test("Computer work_code budget reserves actual write bytes before provider writes", async () => {
  const calls: unknown[] = [];
  const functions = applyComputerWorkBudget({ write: async (input) => { calls.push(input); return "ok"; } });
  const writes = COMPUTER_WORK_CODE_MAX_CUMULATIVE_WRITE_BYTES / (32 * 1024);
  for (let index = 0; index < writes; index += 1) {
    assert.equal(await functions.write({ content: "x".repeat(32 * 1024) }), "ok");
  }
  await assert.rejects(() => functions.write({ content: "x" }), /cumulative write budget/);
  assert.equal(calls.length, writes);
});
