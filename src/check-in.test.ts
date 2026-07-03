import assert from "node:assert/strict";
import test from "node:test";
import { composeOwnerCheckIn } from "./check-in";
import { isActionableNotificationKind, ACTIONABLE_NOTIFICATION_KINDS } from "./notify";

const job = { id: "job-1", name: "Digest", status: "active", next_run_at: "2026-06-25", last_error: null };
const run = { id: "run-1", title: "Ship", task_summary: "Ship it", status: "running", updated_at: "2026-06-24" };

test("isActionableNotificationKind covers each documented actionable kind and rejects everything else", () => {
  for (const kind of ACTIONABLE_NOTIFICATION_KINDS) {
    assert.equal(isActionableNotificationKind(kind), true, `${kind} should be actionable`);
  }
  for (const kind of ["session.update", "job.complete", "delegate.complete", "watch.fired", "unknown.future", "", " "]) {
    assert.equal(isActionableNotificationKind(kind), false, `${kind} should NOT be actionable`);
  }
  assert.equal(isActionableNotificationKind(null), false);
  assert.equal(isActionableNotificationKind(undefined), false);
});

test("check-in prioritizes actionable unread owner attention", () => {
  const result = composeOwnerCheckIn({
    attention: [{ id: "a", kind: "recipe.approval", title: "Choose", body: "Pick one", href: "/api/decisions/a", created_at: "2026-06-24" }],
    jobs: [job],
    runs: [run],
  });
  assert.equal(result.summary, "1 item needs your attention; 2 active.");
  assert.equal(result.needsOwner[0].id, "a");
  assert.deepEqual(result.informationalUpdates, []);
  assert.deepEqual(result.suggestedSteers, [
    { label: "Review recipe.approval attention", href: "/api/attention?kind=recipe.approval" },
    { label: "Review running work", href: "/api/runs?status=running" },
    { label: "Review active recurring jobs", href: "/api/jobs?status=active" },
  ]);
  assert.deepEqual(result.totals, { attention: 1, attentionActionable: 1, attentionInformational: 0, activeJobs: 1, openRuns: 1, completedRuns: 0, failedRuns: 0 });
  assert.deepEqual(result.buckets.map(({ key, total, sampleCount, sampleIds, steer }) => ({ key, total, sampleCount, sampleIds, steer: steer ?? null })), [
    { key: "attention", total: 1, sampleCount: 1, sampleIds: ["a"], steer: { label: "Review recipe.approval attention", href: "/api/attention?kind=recipe.approval" } },
    { key: "failedRuns", total: 0, sampleCount: 0, sampleIds: [], steer: null },
    { key: "openRuns", total: 1, sampleCount: 1, sampleIds: ["run-1"], steer: { label: "Review running work", href: "/api/runs?status=running" } },
    { key: "activeJobs", total: 1, sampleCount: 1, sampleIds: ["job-1"], steer: { label: "Review active recurring jobs", href: "/api/jobs?status=active" } },
    { key: "informationalAttention", total: 0, sampleCount: 0, sampleIds: [], steer: null },
    { key: "completedRuns", total: 0, sampleCount: 0, sampleIds: [], steer: null },
  ]);
  assert.equal(Object.hasOwn(result.buckets[0], "steers"), false);
  assert.deepEqual(result.deployment, { versionId: null, versionTag: null, versionTimestamp: null });
  assert.match(result.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("check-in steers to filtered attention when the top actionable item has a kind", () => {
  const result = composeOwnerCheckIn({
    attention: [{ id: "a", kind: "session.dead", title: "Session died", body: "Read this", href: "/?session=abc", created_at: "2026-06-24" }],
    jobs: [job],
    runs: [run],
  });
  assert.deepEqual(result.suggestedSteers, [
    { label: "Review session.dead attention", href: "/api/attention?kind=session.dead" },
    { label: "Review running work", href: "/api/runs?status=running" },
    { label: "Review active recurring jobs", href: "/api/jobs?status=active" },
  ]);
});

test("check-in classifies informational kinds separately and never inflates the actionable headline", () => {
  const result = composeOwnerCheckIn({
    attention: [
      { id: "s1", kind: "session.update", title: "Session updated", body: "fyi", href: "/?session=x", created_at: "2026-06-24" },
      { id: "j1", kind: "job.complete", title: "Job done", body: "fyi", href: "/jobs/x", created_at: "2026-06-24" },
      { id: "u1", kind: "unknown.future", title: "New kind", body: "fyi", href: "/x", created_at: "2026-06-24" },
    ],
    jobs: [],
    runs: [],
  });
  assert.equal(result.needsOwner.length, 0);
  assert.equal(result.informationalUpdates.length, 3);
  assert.equal(result.summary, "0 items need your attention; 3 updates awaiting review; 0 active.");
  assert.equal(result.totals.attentionActionable, 0);
  assert.equal(result.totals.attentionInformational, 3);
  assert.equal(result.totals.attention, 3);
  const infoBucket = result.buckets.find((b) => b.key === "informationalAttention");
  assert.deepEqual(infoBucket?.sampleIds, ["s1", "j1", "u1"]);
  assert.equal(infoBucket?.steer?.label, "Review session.update updates");
});

test("check-in splits mixed unread rows without lying about totals", () => {
  const result = composeOwnerCheckIn({
    attention: [
      { id: "gate", kind: "deploy.gate", title: "Gate", body: "Approve", href: "/deploy/g", created_at: "2026-06-24" },
      { id: "upd", kind: "session.update", title: "Update", body: "fyi", href: "/?session=x", created_at: "2026-06-24" },
    ],
    jobs: [],
    runs: [],
  });
  assert.deepEqual(result.needsOwner.map((r) => r.id), ["gate"]);
  assert.deepEqual(result.informationalUpdates.map((r) => r.id), ["upd"]);
  assert.equal(result.summary, "1 item needs your attention; 1 update awaiting review; 0 active.");
  assert.equal(result.totals.attention, 2);
  assert.equal(result.totals.attentionActionable, 1);
  assert.equal(result.totals.attentionInformational, 1);
});

test("check-in respects caller-supplied pre-split attention samples verbatim", () => {
  const result = composeOwnerCheckIn({
    attention: [{ id: "a1", kind: "job.needs_input", title: "Job blocked", body: "?", href: "/jobs/a1", created_at: "2026-06-24" }],
    informationalAttention: [{ id: "i1", kind: "session.update", title: "Update", body: "fyi", href: "/?session=y", created_at: "2026-06-24" }],
    jobs: [],
    runs: [],
    totals: { attention: 5, attentionActionable: 2, attentionInformational: 3 },
  });
  assert.deepEqual(result.needsOwner.map((r) => r.id), ["a1"]);
  assert.deepEqual(result.informationalUpdates.map((r) => r.id), ["i1"]);
  assert.equal(result.totals.attention, 5);
  assert.equal(result.totals.attentionActionable, 2);
  assert.equal(result.totals.attentionInformational, 3);
  assert.equal(result.summary, "2 items need your attention; 3 updates awaiting review; 0 active.");
});

test("check-in includes the deployed worker version receipt when provided", () => {
  const result = composeOwnerCheckIn({
    attention: [],
    jobs: [],
    runs: [],
    deployment: { versionId: "version-123", versionTag: "release", versionTimestamp: "2026-06-27T23:40:00Z" },
  });
  assert.deepEqual(result.deployment, { versionId: "version-123", versionTag: "release", versionTimestamp: "2026-06-27T23:40:00Z" });
});

test("check-in exposes an authoritative checked-at timestamp", () => {
  const result = composeOwnerCheckIn({
    attention: [],
    jobs: [],
    runs: [],
    checkedAt: "2026-06-28T01:45:00.000Z",
  });
  assert.equal(result.checkedAt, "2026-06-28T01:45:00.000Z");
});

test("check-in separates completed receipts from running work", () => {
  const completed = { ...run, id: "run-2", status: "completed" };
  const result = composeOwnerCheckIn({ attention: [], jobs: [], runs: [completed] });
  assert.equal(result.summary, "0 active; 1 recently completed.");
  assert.equal(result.completed[0].id, "run-2");
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.running, { jobs: [], runs: [] });
  assert.equal(result.suggestedSteers[0].label, "Start a conversation");
});

test("check-in steers to filtered open work when the sampled work is open", () => {
  const result = composeOwnerCheckIn({ attention: [], jobs: [], runs: [{ ...run, status: "open" }] });
  assert.deepEqual(result.suggestedSteers, [{ label: "Review open work", href: "/api/runs?status=open" }]);
});

test("check-in steers to filtered active recurring jobs when jobs are the main work", () => {
  const result = composeOwnerCheckIn({ attention: [], jobs: [job], runs: [] });
  assert.deepEqual(result.suggestedSteers, [{ label: "Review active recurring jobs", href: "/api/jobs?status=active" }]);
});

test("check-in surfaces failed terminal runs before ordinary active work", () => {
  const failed = { ...run, id: "run-failed", status: "failed" };
  const result = composeOwnerCheckIn({ attention: [], jobs: [job], runs: [failed, run] });
  assert.equal(result.summary, "1 failed run needs review; 2 active.");
  assert.equal(result.failed[0].id, "run-failed");
  assert.equal(result.running.runs[0].id, "run-1");
  assert.deepEqual(result.suggestedSteers, [
    { label: "Review failed work", href: "/api/runs?status=failed" },
    { label: "Review running work", href: "/api/runs?status=running" },
    { label: "Review active recurring jobs", href: "/api/jobs?status=active" },
  ]);
});

test("actionable unread attention still outranks failed run steering", () => {
  const failed = { ...run, id: "run-failed", status: "failed" };
  const result = composeOwnerCheckIn({
    attention: [{ id: "a", kind: "recipe.approval", title: "Choose", body: "Pick one", href: "/api/decisions/a", created_at: "2026-06-24" }],
    jobs: [],
    runs: [failed],
  });
  assert.equal(result.summary, "1 item needs your attention; 0 active.");
  assert.equal(result.failed[0].id, "run-failed");
  assert.deepEqual(result.suggestedSteers, [
    { label: "Review recipe.approval attention", href: "/api/attention?kind=recipe.approval" },
    { label: "Review failed work", href: "/api/runs?status=failed" },
  ]);
});

test("check-in summary uses exact split totals when samples are capped", () => {
  const attention = Array.from({ length: 10 }, (_, i) => ({
    id: `a-${i}`,
    kind: "job.needs_input",
    title: "Needs review",
    body: "Receipt",
    href: `/attention/${i}`,
    created_at: "2026-06-24",
  }));
  const result = composeOwnerCheckIn({
    attention,
    jobs: [job],
    runs: [run],
    totals: { attention: 14, attentionActionable: 14, attentionInformational: 0, activeJobs: 2, openRuns: 3, completedRuns: 7, failedRuns: 4 },
  });
  assert.equal(result.needsOwner.length, 10);
  assert.equal(result.summary, "14 items need your attention; 5 active.");
  assert.deepEqual(result.totals, { attention: 14, attentionActionable: 14, attentionInformational: 0, activeJobs: 2, openRuns: 3, completedRuns: 7, failedRuns: 4 });
});

test("check-in legacy caller supplying only totals.attention keeps the pre-split contract", () => {
  const attention = Array.from({ length: 10 }, (_, i) => ({
    id: `a-${i}`,
    title: "Needs review",
    body: "Receipt",
    href: `/attention/${i}`,
    created_at: "2026-06-24",
  }));
  const result = composeOwnerCheckIn({
    attention,
    jobs: [],
    runs: [],
    totals: { attention: 14 },
  });
  assert.equal(result.needsOwner.length, 10);
  assert.equal(result.informationalUpdates.length, 0);
  assert.equal(result.summary, "14 items need your attention; 0 active.");
  assert.equal(result.totals.attention, 14);
  assert.equal(result.totals.attentionActionable, 14);
  assert.equal(result.totals.attentionInformational, 0);
});

test("check-in split totals never lie: authoritative counts survive capped mixed samples", () => {
  const actionable = Array.from({ length: 12 }, (_, i) => ({
    id: `x-${i}`,
    kind: "deploy.gate",
    title: "Approve",
    body: "gate",
    href: `/deploy/${i}`,
    created_at: "2026-06-24",
  }));
  const informational = Array.from({ length: 15 }, (_, i) => ({
    id: `y-${i}`,
    kind: "session.update",
    title: "FYI",
    body: "fyi",
    href: `/?session=${i}`,
    created_at: "2026-06-24",
  }));
  const result = composeOwnerCheckIn({
    attention: actionable,
    informationalAttention: informational,
    jobs: [],
    runs: [],
    totals: { attention: 27, attentionActionable: 12, attentionInformational: 15 },
  });
  assert.equal(result.needsOwner.length, 10);
  assert.equal(result.informationalUpdates.length, 10);
  assert.equal(result.totals.attention, 27);
  assert.equal(result.totals.attentionActionable, 12);
  assert.equal(result.totals.attentionInformational, 15);
  assert.equal(result.summary, "12 items need your attention; 15 updates awaiting review; 0 active.");
});

test("check-in failed summary uses exact failed totals when the failed sample is capped", () => {
  const failedRuns = Array.from({ length: 10 }, (_, i) => ({ ...run, id: `failed-${i}`, status: "failed" }));
  const result = composeOwnerCheckIn({
    attention: [],
    jobs: [],
    runs: failedRuns,
    totals: { failedRuns: 12 },
  });
  assert.equal(result.failed.length, 10);
  assert.equal(result.summary, "12 failed runs need review; 0 active.");
  assert.equal(result.totals.failedRuns, 12);
});

test("check-in keeps failed work visible ahead of informational updates", () => {
  const result = composeOwnerCheckIn({
    attention: [],
    informationalAttention: [{ id: "update", kind: "session.update", title: "Done", body: "FYI", href: "/", created_at: "2026-06-24" }],
    jobs: [],
    runs: [{ ...run, id: "failed", status: "failed" }],
    totals: { attention: 8, attentionActionable: 0, attentionInformational: 8, failedRuns: 2, openRuns: 1 },
  });
  assert.equal(result.summary, "2 failed runs need review; 8 updates awaiting review; 1 active.");
});

test("check-in does not report non-zero run totals with empty status samples", () => {
  const failed = { ...run, id: "failed-visible", status: "failed" };
  const open = { ...run, id: "open-visible", status: "open" };
  const result = composeOwnerCheckIn({
    attention: [],
    jobs: [],
    runs: [failed, open, ...Array.from({ length: 10 }, (_, i) => ({ ...run, id: `completed-${i}`, status: "completed" }))],
    totals: { failedRuns: 2, openRuns: 1, completedRuns: 51 },
  });
  assert.equal(result.failed.length, 1);
  assert.equal(result.running.runs.length, 1);
  assert.equal(result.buckets.find((bucket) => bucket.key === "failedRuns")?.sampleCount, 1);
  assert.equal(result.buckets.find((bucket) => bucket.key === "openRuns")?.sampleCount, 1);
  assert.deepEqual(result.buckets.find((bucket) => bucket.key === "failedRuns")?.sampleIds, ["failed-visible"]);
  assert.deepEqual(result.buckets.find((bucket) => bucket.key === "openRuns")?.sampleIds, ["open-visible"]);
});
