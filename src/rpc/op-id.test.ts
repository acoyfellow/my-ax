import assert from "node:assert/strict";
import test from "node:test";
import { callOpId } from "./op-id";

test("a well-formed caller operation id is forwarded to the laptop unchanged", () => {
  assert.equal(callOpId("op-retry-0001", undefined), "op-retry-0001");
  assert.equal(callOpId(null, { _meta: { opId: "op-from-meta-1" } }), "op-from-meta-1");
});

test("a missing or malformed operation id is replaced with a fresh one", () => {
  const minted = callOpId(null, undefined);
  assert.match(minted, /^[0-9a-f-]{36}$/);
  assert.notEqual(callOpId("bad id with spaces", undefined), "bad id with spaces");
  assert.notEqual(callOpId("x".repeat(500), undefined).length, 500);
});
