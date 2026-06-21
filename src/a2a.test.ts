import test from "node:test";
import assert from "node:assert/strict";
import { A2AMessage, bearer, messageHash, newGrantToken, sha256 } from "./a2a";

test("accepts only bounded text user messages", () => {
  assert.equal(A2AMessage.safeParse({ messageId: "m1", role: "user", parts: [{ kind: "text", text: "hello" }] }).success, true);
  assert.equal(A2AMessage.safeParse({ messageId: "m1", role: "agent", parts: [{ kind: "text", text: "hello" }] }).success, false);
  assert.equal(A2AMessage.safeParse({ messageId: "m1", role: "user", parts: [{ kind: "file", url: "x" }] }).success, false);
  assert.equal(A2AMessage.safeParse({ messageId: "m1", role: "user", parts: [{ kind: "text", text: "x" }], tools: [] }).success, false);
});

test("grant tokens are opaque and hash-only storage is deterministic", async () => {
  const token = newGrantToken();
  assert.match(token, /^ax_a2a_[A-Za-z0-9_-]{40,}$/);
  assert.equal((await sha256(token)).length, 64);
  assert.notEqual(await sha256(token), token);
});

test("bearer parsing is strict", () => {
  const token = newGrantToken();
  assert.equal(bearer(`Bearer ${token}`), token);
  assert.equal(bearer(`Basic ${token}`), null);
  assert.equal(bearer(undefined), null);
});

test("message hash dedupes exact messages and conflicts changed content", async () => {
  const one = A2AMessage.parse({ messageId: "same", role: "user", parts: [{ kind: "text", text: "one" }] });
  const duplicate = A2AMessage.parse({ messageId: "same", role: "user", parts: [{ kind: "text", text: "one" }] });
  const changed = A2AMessage.parse({ messageId: "same", role: "user", parts: [{ kind: "text", text: "two" }] });
  assert.equal(await messageHash(one), await messageHash(duplicate));
  assert.notEqual(await messageHash(one), await messageHash(changed));
});
