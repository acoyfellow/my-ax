import assert from "node:assert/strict";
import test from "node:test";
import { recurringJobReceipt } from "./recurring-job-receipt";

test("successful recurring work has an actionable owner receipt", () => {
  const receipt = recurringJobReceipt({ jobId: "job-1", jobName: "Daily brief", sessionId: "session 1" });
  assert.deepEqual(receipt, {
    kind: "job.complete",
    sessionId: "session 1",
    title: "Daily brief completed",
    body: "Completed successfully. Next action: open the conversation to review the result.",
    href: "/?session=session%201",
    dedupeKey: "recurring-job:job-1",
  });
});

test("failed recurring work tells the owner its terminal state and next action", () => {
  const receipt = recurringJobReceipt({ jobId: "job-2", jobName: "Monitor", sessionId: "session-2", error: "connector timed out\nwith no response" });
  assert.equal(receipt.title, "Monitor failed");
  assert.match(receipt.body, /^connector timed out with no response/);
  assert.match(receipt.body, /Next action: open the conversation and retry or update the job\.$/);
});
