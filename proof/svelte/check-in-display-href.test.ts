import test from "node:test";
import assert from "node:assert/strict";
import { displayCheckInHref } from "./check-in-display-href";

test("displayCheckInHref maps raw Check-in API steers to rendered owner destinations", () => {
  assert.equal(displayCheckInHref("/api/attention"), "/attention");
  assert.equal(displayCheckInHref("/api/runs"), "/runs");
  assert.equal(displayCheckInHref("/api/jobs"), "/jobs");
});

test("displayCheckInHref preserves Check-in steer query filters", () => {
  assert.equal(displayCheckInHref("/api/attention?kind=job.complete"), "/attention?kind=job.complete");
  assert.equal(displayCheckInHref("/api/runs?status=failed"), "/runs?status=failed");
  assert.equal(displayCheckInHref("/api/jobs?status=active"), "/jobs?status=active");
});

test("displayCheckInHref leaves non-owner-rendered hrefs unchanged", () => {
  assert.equal(displayCheckInHref("/api/check-in"), "/api/check-in");
  assert.equal(displayCheckInHref("/sessions/abc"), "/sessions/abc");
});
