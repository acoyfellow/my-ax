import assert from "node:assert/strict";
import test from "node:test";
import type { WorkspaceLike } from "@cloudflare/think/tools/workspace";
import type { AccessIdentity } from "./auth";
import { DelegateCapabilityError, ReadOnlyDelegateWorkspace, splitDelegateRunInput } from "./read-only-delegate-workspace";

const owner: AccessIdentity = { email: "owner@example.com", sub: "owner-sub" };

function ownerSandboxWorkspace(files: Map<string, string>, opened: AccessIdentity[]): (identity: AccessIdentity) => WorkspaceLike {
  return (identity) => {
    opened.push(identity);
    return {
      readFile: async (path: string) => files.get(path) ?? null,
      readFileBytes: async (path: string) => (files.has(path) ? new TextEncoder().encode(files.get(path)) : null),
      readDir: async () => [...files.keys()].map((path) => ({ path, name: path.split("/").pop() ?? path, type: "file" as const, mimeType: "text/plain", size: 1, createdAt: 0, updatedAt: 0 })),
      glob: async () => [],
      stat: async () => null,
      writeFile: async (path: string, content: string) => { files.set(path, content); },
      mkdir: async () => {},
      rm: async (path: string) => { files.delete(path); },
    } as WorkspaceLike;
  };
}

test("delegate reads a parent-visible file from the owner Sandbox workspace", async () => {
  const files = new Map([["/home/user/my-ax/package.json", "{\"name\":\"my-ax\"}"]]);
  const opened: AccessIdentity[] = [];
  const workspace = new ReadOnlyDelegateWorkspace(() => owner, ownerSandboxWorkspace(files, opened));
  assert.equal(await workspace.readFile("/home/user/my-ax/package.json"), "{\"name\":\"my-ax\"}");
  assert.equal((await workspace.readDir("/home/user/my-ax")).length, 1);
  assert.deepEqual(opened[0], owner);
});

test("delegate workspace refuses writes with a typed capability error", async () => {
  const files = new Map([["/home/user/a.txt", "keep"]]);
  const workspace = new ReadOnlyDelegateWorkspace(() => owner, ownerSandboxWorkspace(files, []));
  await assert.rejects(workspace.writeFile("/home/user/a.txt", "x"), (error: unknown) => error instanceof DelegateCapabilityError && error.code === "delegate_read_only");
  await assert.rejects(workspace.rm("/home/user/a.txt"), DelegateCapabilityError);
  await assert.rejects(workspace.mkdir("/home/user/d"), DelegateCapabilityError);
  assert.equal(files.get("/home/user/a.txt"), "keep");
});

test("delegate without identity fails with a typed error instead of file not found", async () => {
  const opened: AccessIdentity[] = [];
  const workspace = new ReadOnlyDelegateWorkspace(() => undefined, ownerSandboxWorkspace(new Map(), opened));
  await assert.rejects(workspace.readFile("/home/user/my-ax/package.json"), (error: unknown) => error instanceof DelegateCapabilityError && error.code === "delegate_identity_missing");
  await assert.rejects(workspace.readDir("/home/user"), DelegateCapabilityError);
  assert.equal(opened.length, 0);
});

test("delegate run input without identity fails closed before the run starts", () => {
  assert.throws(() => splitDelegateRunInput({ task: "inspect" }), (error: unknown) => error instanceof DelegateCapabilityError && error.code === "delegate_identity_missing");
  assert.deepEqual(splitDelegateRunInput({ task: "inspect", identity: owner }), { task: "inspect", identity: owner });
});
