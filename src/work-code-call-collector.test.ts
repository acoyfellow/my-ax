import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPUTER_WORK_CODE_MAX_CALLS,
  COMPUTER_WORK_CODE_MAX_CONCURRENCY,
  applyComputerWorkBudget,
} from "./computer-work-budget";
import {
  capWorkCodeCollectionWithMetadata,
  instrumentWorkCodeFunctions,
  WorkCodeCallCollector,
  WORK_CODE_CALLS_MAX_BYTES,
  WORK_CODE_CALLS_MAX_ENTRIES,
} from "./work-code-output";
import { isSandboxMutationWorkCodeCall, shouldSnapshotSandboxForToolCall } from "./workspace-snapshot-classification";

function instrument(
  where: string,
  functions: Record<string, (input: unknown) => Promise<unknown>>,
  collector: WorkCodeCallCollector,
) {
  return instrumentWorkCodeFunctions(where, functions, collector, (method) => ({
    sandboxMutation: isSandboxMutationWorkCodeCall({ where, method }),
    codemodeInvoked: where === "codemode",
  }));
}

function receipt(collector: WorkCodeCallCollector) {
  const serialized = capWorkCodeCollectionWithMetadata(collector.calls, WORK_CODE_CALLS_MAX_ENTRIES, WORK_CODE_CALLS_MAX_BYTES);
  return {
    ok: true,
    calls: serialized.values,
    callsTruncated: collector.callsTruncated || serialized.truncated,
    sandboxMutation: collector.sandboxMutation,
    codemodeInvoked: collector.codemodeInvoked,
    inferredCapabilities: collector.inferredCapabilities,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

async function recordLateWorkspaceAndCodemodeCalls(collector: WorkCodeCallCollector) {
  const workspace = instrument("workspace", { write: async () => "written" }, collector);
  const codemode = instrument("codemode", { run: async () => "ran" }, collector);
  assert.equal(await workspace.write({}), "written");
  assert.equal(await codemode.run({}), "ran");
}

function isCallTo(call: unknown, where: string, method: string): boolean {
  if (!call || typeof call !== "object") return false;
  const record = call as { where?: unknown; method?: unknown };
  return record.where === where && record.method === method;
}

function assertSaturatedLateCallsRemainSafe(collector: WorkCodeCallCollector) {
  const output = receipt(collector);
  assert.ok(collector.calls.length <= WORK_CODE_CALLS_MAX_ENTRIES);
  assert.equal(collector.attemptedCalls, WORK_CODE_CALLS_MAX_ENTRIES + 1);
  assert.equal(output.callsTruncated, true);
  assert.equal(output.sandboxMutation, true);
  assert.equal(output.codemodeInvoked, true);
  assert.equal(output.calls.some((call) => isCallTo(call, "workspace", "write")), false);
  assert.equal(output.calls.some((call) => isCallTo(call, "codemode", "run")), false);
  assert.deepEqual(output.inferredCapabilities, ["codemode.run", "computer.list", "workspace.write"]);
  assert.equal(shouldSnapshotSandboxForToolCall("work_code", JSON.stringify(output)), true);
}

test("sequential caught Computer budget retries keep the host receipt collector bounded", async () => {
  let providerCalls = 0;
  const collector = new WorkCodeCallCollector();
  const computer = instrument("computer", applyComputerWorkBudget({
    list: async () => {
      providerCalls += 1;
      return "ok";
    },
  }), collector);

  for (let index = 0; index < 2_000; index += 1) {
    await computer.list({}).catch(() => undefined);
  }

  await recordLateWorkspaceAndCodemodeCalls(collector);

  assert.equal(providerCalls, COMPUTER_WORK_CODE_MAX_CALLS);
  assertSaturatedLateCallsRemainSafe(collector);
});

test("concurrent caught Computer budget retries cannot reset provider calls or grow host receipts", async () => {
  const gates = Array.from({ length: COMPUTER_WORK_CODE_MAX_CONCURRENCY }, () => deferred<string>());
  let providerCalls = 0;
  const collector = new WorkCodeCallCollector();
  const computer = instrument("computer", applyComputerWorkBudget({
    list: async () => {
      const gate = gates[providerCalls];
      providerCalls += 1;
      return gate.promise;
    },
  }), collector);
  const active = gates.map(() => computer.list({}));
  const rejected = Promise.all(Array.from({ length: 2_000 }, () => computer.list({})
    .catch(() => computer.list({}).catch(() => undefined))));

  await rejected;
  for (const gate of gates) gate.resolve("ok");
  await Promise.all(active);
  for (let index = 0; index < 2_000; index += 1) {
    await computer.list({}).catch(() => undefined);
  }
  await recordLateWorkspaceAndCodemodeCalls(collector);

  assert.equal(providerCalls, COMPUTER_WORK_CODE_MAX_CONCURRENCY);
  assertSaturatedLateCallsRemainSafe(collector);
});

test("a successful Computer-only receipt remains outside Sandbox snapshots", async () => {
  const collector = new WorkCodeCallCollector();
  const computer = instrument("computer", { write: async () => "ok" }, collector);
  assert.equal(await computer.write({}), "ok");

  const output = receipt(collector);
  assert.equal(output.callsTruncated, false);
  assert.equal(output.sandboxMutation, false);
  assert.equal(output.codemodeInvoked, false);
  assert.deepEqual(output.inferredCapabilities, ["computer.write"]);
  assert.equal(shouldSnapshotSandboxForToolCall("work_code", JSON.stringify(output)), false);
});
