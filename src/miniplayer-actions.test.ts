import { test } from "node:test";
import * as assert from "node:assert/strict";
import { buildAction, canSend } from "./miniplayer-actions";

test("buildAction with send kind", () => {
  const action = buildAction("send", "session123", "hello world");
  assert.deepEqual(action, {
    type: "send",
    sessionId: "session123",
    content: "hello world",
  });
});

test("buildAction with send kind trims content", () => {
  const action = buildAction("send", "session123", "  hello world  ");
  assert.deepEqual(action, {
    type: "send",
    sessionId: "session123",
    content: "hello world",
  });
});

test("buildAction with send kind throws empty_content when content is missing", () => {
  assert.throws(
    () => buildAction("send", "session123"),
    (err) => err instanceof Error && err.message === "empty_content"
  );
});

test("buildAction with send kind throws empty_content when content is empty", () => {
  assert.throws(
    () => buildAction("send", "session123", ""),
    (err) => err instanceof Error && err.message === "empty_content"
  );
});

test("buildAction with send kind throws empty_content when content is whitespace only", () => {
  assert.throws(
    () => buildAction("send", "session123", "   "),
    (err) => err instanceof Error && err.message === "empty_content"
  );
});

test("buildAction with send kind throws missing_session when sessionId is empty", () => {
  assert.throws(
    () => buildAction("send", "", "hello"),
    (err) => err instanceof Error && err.message === "missing_session"
  );
});

test("buildAction with send kind throws missing_session when sessionId is not a string", () => {
  assert.throws(
    () => buildAction("send", undefined as any, "hello"),
    (err) => err instanceof Error && err.message === "missing_session"
  );
});

test("buildAction with stop kind", () => {
  const action = buildAction("stop", "session123");
  assert.deepEqual(action, {
    type: "stop",
    sessionId: "session123",
  });
});

test("buildAction with stop kind ignores content", () => {
  const action = buildAction("stop", "session123", "ignored");
  assert.deepEqual(action, {
    type: "stop",
    sessionId: "session123",
  });
});

test("buildAction with stop kind throws missing_session when sessionId is empty", () => {
  assert.throws(
    () => buildAction("stop", ""),
    (err) => err instanceof Error && err.message === "missing_session"
  );
});

test("buildAction with expand kind", () => {
  const action = buildAction("expand", "session456");
  assert.deepEqual(action, {
    type: "expand",
    sessionId: "session456",
  });
});

test("buildAction with expand kind ignores content", () => {
  const action = buildAction("expand", "session456", "ignored");
  assert.deepEqual(action, {
    type: "expand",
    sessionId: "session456",
  });
});

test("buildAction with expand kind throws missing_session when sessionId is empty", () => {
  assert.throws(
    () => buildAction("expand", ""),
    (err) => err instanceof Error && err.message === "missing_session"
  );
});

test("buildAction with switch kind", () => {
  const action = buildAction("switch", "session789");
  assert.deepEqual(action, {
    type: "switch",
    sessionId: "session789",
  });
});

test("buildAction with switch kind ignores content", () => {
  const action = buildAction("switch", "session789", "ignored");
  assert.deepEqual(action, {
    type: "switch",
    sessionId: "session789",
  });
});

test("buildAction with switch kind throws missing_session when sessionId is empty", () => {
  assert.throws(
    () => buildAction("switch", ""),
    (err) => err instanceof Error && err.message === "missing_session"
  );
});

test("buildAction with unknown kind throws unknown_action", () => {
  assert.throws(
    () => buildAction("invalid" as any, "session123"),
    (err) => err instanceof Error && err.message === "unknown_action"
  );
});

test("canSend returns true for valid content", () => {
  assert.equal(canSend("hello world"), true);
});

test("canSend returns true for content with leading/trailing whitespace", () => {
  assert.equal(canSend("  hello world  "), true);
});

test("canSend returns false for empty string", () => {
  assert.equal(canSend(""), false);
});

test("canSend returns false for whitespace only", () => {
  assert.equal(canSend("   "), false);
});

test("canSend returns true for content at 4000 character limit", () => {
  const content = "a".repeat(4000);
  assert.equal(canSend(content), true);
});

test("canSend returns false for content over 4000 character limit", () => {
  const content = "a".repeat(4001);
  assert.equal(canSend(content), false);
});

test("canSend returns false for non-string input", () => {
  assert.equal(canSend(null as any), false);
  assert.equal(canSend(undefined as any), false);
  assert.equal(canSend(123 as any), false);
});

test("canSend returns true for single character", () => {
  assert.equal(canSend("a"), true);
});

test("canSend returns true for content with internal whitespace", () => {
  assert.equal(canSend("hello   world"), true);
});

test("canSend counts trimmed length for 4000 character limit", () => {
  const content = " " + "a".repeat(4000) + " ";
  assert.equal(canSend(content), true);
});

test("canSend returns false when trimmed length exceeds 4000", () => {
  const content = " " + "a".repeat(4001) + " ";
  assert.equal(canSend(content), false);
});
