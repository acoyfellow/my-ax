import assert from "node:assert/strict";
import test from "node:test";
import { recurringJobReceipt } from "./recurring-job-receipt";

test("same-session recurring work says it updated the existing conversation", () => {
  const receipt = recurringJobReceipt({ jobId: "job-1", jobName: "Daily brief", sessionId: "session 1", threadMode: "same_session", ranAt: new Date("2026-01-01T00:00:00.000Z") });
  assert.deepEqual(receipt, {
    kind: "job.complete",
    sessionId: "session 1",
    title: "Daily brief completed",
    body: "Completed successfully in the existing conversation. Next action: open it to review the result.",
    href: "/?session=session%201",
    dedupeKey: "recurring-job:job-1:session 1:2026-01-01T00:00:00.000Z",
  });
});

test("new-session recurring work says it created a fresh conversation", () => {
  const receipt = recurringJobReceipt({ jobId: "job-1", jobName: "Daily brief", sessionId: "session-new", sourceSessionId: "session-source", threadMode: "new_session_per_run", ranAt: new Date("2026-01-01T01:00:00.000Z") });
  assert.equal(receipt.href, "/?session=session-new");
  assert.equal(receipt.sessionId, "session-new");
  assert.match(receipt.body, /in a new conversation/);
  assert.equal(receipt.dedupeKey, "recurring-job:job-1:session-new:2026-01-01T01:00:00.000Z");
});

test("failed recurring work tells the owner its terminal state and destination", () => {
  const receipt = recurringJobReceipt({ jobId: "job-2", jobName: "Monitor", sessionId: "session-2", threadMode: "same_session", error: "connector timed out\nwith no response" });
  assert.equal(receipt.title, "Monitor failed");
  assert.match(receipt.body, /^connector timed out with no response/);
  assert.match(receipt.body, /Next action: open the existing conversation and retry or update the job\.$/);
});
