import assert from "node:assert/strict";
import { test } from "node:test";
import { clearRefusal, isRootSession, refuseIfRoot, ROOT_STABLE_NAME } from "./root-session";

const root = { stable_name: ROOT_STABLE_NAME, status: "active" };
const ordinary = { stable_name: null, status: "active" };

test("root is the conversation with the stable name root", () => {
  assert.equal(isRootSession(root), true);
  assert.equal(isRootSession(ordinary), false);
  assert.equal(isRootSession({ stable_name: "rooted", status: "active" }), false);
  assert.equal(isRootSession(null), false);
});

test("deleting or archiving root is refused", () => {
  assert.equal(refuseIfRoot(root, "delete")?.code, "ROOT_PROTECTED");
  assert.equal(refuseIfRoot(root, "archive")?.code, "ROOT_PROTECTED");
});

test("ordinary conversations can still be deleted and archived", () => {
  assert.equal(refuseIfRoot(ordinary, "delete"), null);
  assert.equal(refuseIfRoot(ordinary, "archive"), null);
  assert.equal(refuseIfRoot(null, "delete"), null);
});

test("clear is only for root, and not while a turn runs", () => {
  assert.equal(clearRefusal(ordinary)?.code, "NOT_ROOT");
  assert.equal(clearRefusal(null)?.code, "NOT_ROOT");
  assert.equal(clearRefusal({ ...root, status: "running" })?.code, "TURN_RUNNING");
  assert.equal(clearRefusal(root), null);
});

test("the conversation list shows root like any other conversation, so it can be pinned and sized", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./routes/sessions.ts", import.meta.url), "utf8");
  const line = source.split("\n").find((each) => each.includes("const archiveFilter ="));
  assert.ok(line, "archiveFilter is defined");
  assert.doesNotMatch(line, /stable_name/);
});
