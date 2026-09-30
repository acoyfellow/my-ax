import assert from "node:assert/strict";
import test from "node:test";
import { applyIssueContext, issueAttributes } from "./issue-context";

test("issue attributes carry user, session, and model when present", () => {
  assert.deepEqual(issueAttributes({ userId: "owner@example.com", sessionId: "s-1", model: "claude-opus-5-5" }), {
    "user.id": "owner@example.com",
    "session.id": "s-1",
    "ai.model": "claude-opus-5-5",
  });
});

test("missing identifiers are omitted rather than written empty", () => {
  assert.deepEqual(issueAttributes({ sessionId: "s-1" }), { "session.id": "s-1" });
});

test("applying context writes every attribute to the active span", () => {
  const written: Array<[string, string]> = [];
  applyIssueContext({ userId: "u", sessionId: "s" }, { setAttribute: (key, value) => written.push([key, value]) });
  assert.deepEqual(written, [["user.id", "u"], ["session.id", "s"]]);
});

test("applying context without a span is a no-op", () => {
  assert.doesNotThrow(() => applyIssueContext({ userId: "u" }, undefined));
});
