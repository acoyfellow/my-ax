import assert from "node:assert/strict";
import test from "node:test";
import { capWorkCodeCollectionWithMetadata, WORK_CODE_CALLS_MAX_BYTES, WORK_CODE_CALLS_MAX_ENTRIES } from "./work-code-output";
import { shouldSnapshotSandboxForToolCall, summarizeWorkCodeSnapshot, type WorkCodeCall } from "./workspace-snapshot-classification";

function workCodeReceipt(calls: WorkCodeCall[]) {
  const snapshot = summarizeWorkCodeSnapshot(calls);
  const capped = capWorkCodeCollectionWithMetadata(calls, WORK_CODE_CALLS_MAX_ENTRIES, WORK_CODE_CALLS_MAX_BYTES);
  return {
    calls: capped.values,
    callsTruncated: capped.truncated,
    sandboxMutation: snapshot.sandboxMutation,
    codemodeInvoked: snapshot.codemodeInvoked,
  };
}

test("workspace mutation metadata remains authoritative after capped call receipts", () => {
  const calls: WorkCodeCall[] = [
    ...Array.from({ length: WORK_CODE_CALLS_MAX_ENTRIES + 1 }, () => ({ where: "workspace", method: "read" })),
    { where: "workspace", method: "write" },
  ];
  const receipt = workCodeReceipt(calls);
  assert.equal(receipt.callsTruncated, true);
  assert.equal(receipt.sandboxMutation, true);
  assert.equal((receipt.calls as WorkCodeCall[]).some((call) => call.where === "workspace" && call.method === "write"), false);
  assert.equal(shouldSnapshotSandboxForToolCall("work_code", JSON.stringify(receipt)), true);
});

test("codemode.run of a workspace-writing saved tool requires a Sandbox snapshot conservatively", () => {
  const workspaceWritingSavedToolReceipt = workCodeReceipt([{ where: "codemode", method: "run" }]);
  assert.equal(workspaceWritingSavedToolReceipt.sandboxMutation, false);
  assert.equal(workspaceWritingSavedToolReceipt.codemodeInvoked, true);
  assert.equal(shouldSnapshotSandboxForToolCall("work_code", JSON.stringify(workspaceWritingSavedToolReceipt)), true);
});

test("truncated work_code calls fail closed for Sandbox snapshots", () => {
  const receipt = {
    calls: [{ where: "computer", method: "write" }],
    callsTruncated: true,
    sandboxMutation: false,
    codemodeInvoked: false,
  };
  assert.equal(shouldSnapshotSandboxForToolCall("work_code", JSON.stringify(receipt)), true);
});

test("Computer-only work_code does not request a Sandbox snapshot", () => {
  const receipt = workCodeReceipt([{ where: "computer", method: "write" }]);
  assert.equal(receipt.callsTruncated, false);
  assert.equal(receipt.sandboxMutation, false);
  assert.equal(receipt.codemodeInvoked, false);
  assert.equal(shouldSnapshotSandboxForToolCall("work_code", JSON.stringify(receipt)), false);
});
