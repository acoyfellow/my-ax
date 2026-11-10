import assert from "node:assert/strict";
import { test } from "node:test";
import { fixedSessionBinding } from "./session-binding";

test("a fixed binding always reads its own session", () => {
  const binding = fixedSessionBinding("root-1");
  assert.equal(binding.followsTab, false);
  assert.equal(binding.read(), "root-1");
  assert.equal(binding.lastUsed(), "root-1");
});

test("a fixed binding never moves to another session", () => {
  const binding = fixedSessionBinding("root-1");
  binding.write("other");
  binding.write(null);
  assert.equal(binding.read(), "root-1");
});

test("two fixed bindings do not share a session", () => {
  const root = fixedSessionBinding("root-1");
  const other = fixedSessionBinding("chat-2");
  other.write("root-1");
  assert.equal(root.read(), "root-1");
  assert.equal(other.read(), "chat-2");
});
