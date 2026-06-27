import assert from "node:assert/strict";
import test from "node:test";
import { delegateCompletionNotification } from "./delegate-receipt";
import type { DelegateResult } from "./delegate-many";

const completed: DelegateResult = {
  runId: "run-1",
  taskFingerprint: "abc",
  status: "completed",
  summary: "done",
  attempts: 1,
};

test("completed delegation receipt sends owner back to the parent synthesis", () => {
  const notification = delegateCompletionNotification({ sessionId: "session 1", results: [completed] });
  assert.equal(notification.kind, "delegate.complete");
  assert.equal(notification.title, "Delegation complete");
  assert.match(notification.body, /1 delegated task completed/);
  assert.equal(notification.href, "/?session=session%201");
  assert.equal(notification.dedupeKey, "delegate:session 1:run-1");
});

test("failed delegation receipt is truthful and actionable", () => {
  const notification = delegateCompletionNotification({
    sessionId: "session-2",
    results: [completed, { ...completed, runId: "run-2", status: "error", error: "boom" }],
  });
  assert.equal(notification.kind, "delegate.needs_input");
  assert.equal(notification.title, "Delegation needs review");
  assert.match(notification.body, /1\/2 delegated tasks did not complete/);
  assert.match(notification.body, /next action/);
});
