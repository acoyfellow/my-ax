import { test } from "node:test";
import assert from "node:assert/strict";
import { PI_EXEC_DEFAULT_TIMEOUT_MS, PI_EXEC_MAX_TIMEOUT_MS, boundedExecTimeout, clipToolOutput } from "./workspace-tools";
import { PI_CHAT_ID_PATTERN, piChatObjectName } from "./routes";
import { workspaceSandboxId } from "../workspace-policy";

test("each pi chat gets its own object and its own sandbox", () => {
  const a = crypto.randomUUID();
  const b = crypto.randomUUID();
  assert.notEqual(piChatObjectName("Owner@Example.com", a), piChatObjectName("owner@example.com", b));
  assert.equal(piChatObjectName("Owner@Example.com", a), `owner@example.com/${a}`);
  assert.notEqual(workspaceSandboxId("owner@example.com", { kind: "chat", chatId: a }), workspaceSandboxId("owner@example.com", { kind: "chat", chatId: b }));
});

test("chat ids are generated uuids, never arbitrary strings", () => {
  assert.ok(PI_CHAT_ID_PATTERN.test(crypto.randomUUID()));
  assert.ok(!PI_CHAT_ID_PATTERN.test("../other-owner"));
  assert.ok(!PI_CHAT_ID_PATTERN.test("x"));
});

test("exec timeouts default sensibly and are capped", () => {
  assert.equal(boundedExecTimeout(undefined), PI_EXEC_DEFAULT_TIMEOUT_MS);
  assert.equal(boundedExecTimeout(-5), PI_EXEC_DEFAULT_TIMEOUT_MS);
  assert.equal(boundedExecTimeout(5_000), 5_000);
  assert.equal(boundedExecTimeout(10 * PI_EXEC_MAX_TIMEOUT_MS), PI_EXEC_MAX_TIMEOUT_MS);
});

test("large tool output is clipped and marked incomplete", () => {
  const clipped = clipToolOutput("x".repeat(40_000));
  assert.ok(clipped.length < 31_000);
  assert.match(clipped, /INCOMPLETE RESULT: 10000 more characters/);
  assert.equal(clipToolOutput("short"), "short");
});
