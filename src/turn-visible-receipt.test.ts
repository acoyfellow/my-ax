import assert from "node:assert/strict";
import test from "node:test";
import { shouldSendCompletionNotification, stripReasoningArtifacts, visibleAssistantContent, visibleCompletionNotificationBody } from "./turn-visible-receipt";

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

test("empty completed responses with owner notifications do not ask the owner to retry", () => {
  const content = visibleAssistantContent({ status: "completed", content: "", error: null, ownerNotified: true });
  assert.match(content, /after sending an owner notification/);
  assert.doesNotMatch(content, /retry/);
});

test("hidden completed turns skip the generic completion push after notify_owner", () => {
  assert.equal(shouldSendCompletionNotification({ status: "completed", hasVisibleChat: false, ownerNotified: false }), true);
  assert.equal(shouldSendCompletionNotification({ status: "completed", hasVisibleChat: false, ownerNotified: true }), false);
  assert.equal(shouldSendCompletionNotification({ status: "completed", hasVisibleChat: true, ownerNotified: false }), false);
  assert.equal(shouldSendCompletionNotification({ status: "error", hasVisibleChat: false, ownerNotified: false }), false);
  assert.equal(shouldSendCompletionNotification({ status: "completed", hasVisibleChat: false, ownerNotified: false, automaticRecovery: true }), false);
});

test("visible turn receipts strip leading scratchpad before done-style answers", () => {
  const content = "I need to get the actual output content. Let me try again.Done. Lee cmux PR exchange checked, notification delivered.";
  assert.equal(stripReasoningArtifacts(content), "Done. Lee cmux PR exchange checked, notification delivered.");
});

test("visible turn receipts strip leading scratchpad before status answers", () => {
  const content = "I'll start by checking tool availability asLee cmux PR exchange status ping sent. Summary captured from the read-screen.";
  assert.equal(stripReasoningArtifacts(content), "Lee cmux PR exchange status ping sent. Summary captured from the read-screen.");
});

test("visible turn receipts strip leading scratchpad before check-complete answers", () => {
  const content = "I'll start by searching for the available machine/cmuxCheck complete. Sent owner notification (`session.update`) for Lee cmux PR exchange.";
  assert.equal(stripReasoningArtifacts(content), "Check complete. Sent owner notification (`session.update`) for Lee cmux PR exchange.");
});

test("visible turn receipts strip leaked think artifacts while preserving the answer", () => {
  const content = [
    "Lee cmux read-screen succeeded; workspace:1 is Lee.",
    "",
    "Status to notify:\n- Active: yes\n- Scoreboard visible: 2 approved, 4 owed",
    "",
    "Need also write same concise status into job session via set_context? The instruction says write the same concise status.",
    "</think>Notification sent and status written to memory. Done with this scheduled check.",
  ].join("\n");

  const stripped = stripReasoningArtifacts(content);
  assert.match(stripped, /Lee cmux read-screen succeeded/);
  assert.match(stripped, /Status to notify/);
  assert.match(stripped, /Notification sent/);
  assert.doesNotMatch(stripped, /Need also/);
  assert.doesNotMatch(stripped, /<\/think>/);
});

test("a truncated (unclosed) <think> block never leaks reasoning into the receipt", () => {
  assert.equal(
    stripReasoningArtifacts("Visible answer\n<think>I need to inspect credentials first"),
    "Visible answer",
  );
});

test("an error status with a blank/null error still yields a visible fallback", () => {
  assert.equal(
    visibleAssistantContent({ status: "error", content: "", error: " \n\t " }),
    "The agent turn failed without a visible error message.",
  );
  assert.equal(
    visibleAssistantContent({ status: "error", content: "", error: null }),
    "The agent turn failed without a visible error message.",
  );
});
