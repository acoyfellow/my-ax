import assert from "node:assert/strict";
import test from "node:test";
import { visibleAssistantContent, visibleCompletionNotificationBody } from "./turn-visible-receipt";

test("visible turn receipts preserve normal assistant content", () => {
  assert.equal(visibleAssistantContent({ status: "completed", content: "done", error: null }), "done");
  assert.equal(visibleCompletionNotificationBody("done"), "done");
});

test("empty completed responses become truthful owner-visible receipts", () => {
  const content = visibleAssistantContent({ status: "completed", content: "", error: null });
  assert.match(content, /completed without a visible response/);
  assert.equal(visibleCompletionNotificationBody(content), content);
});

test("visible turn receipts use model error text for error responses", () => {
  assert.equal(visibleAssistantContent({ status: "error", content: "", error: "Invalid URL string." }), "Invalid URL string.");
});
