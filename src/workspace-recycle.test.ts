import assert from "node:assert/strict";
import test from "node:test";
import { persistBeforeWorkspaceDestroy } from "./workspace-recycle";

test("workspace recycle publishes a snapshot before destroying the container", async () => {
  const calls: string[] = [];
  await persistBeforeWorkspaceDestroy(
    async () => { calls.push("snapshot"); },
    async () => { calls.push("destroy"); },
  );
  assert.deepEqual(calls, ["snapshot", "destroy"]);
});

test("workspace recycle keeps the live container when snapshot publication fails", async () => {
  let destroyed = false;
  await assert.rejects(
    persistBeforeWorkspaceDestroy(
      async () => { throw new Error("snapshot failed"); },
      async () => { destroyed = true; },
    ),
    /snapshot failed/,
  );
  assert.equal(destroyed, false);
});
