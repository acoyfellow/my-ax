import assert from "node:assert/strict";
import test from "node:test";
import type { JobRow } from "./jobs";
import {
  buildJobListView,
  JOB_LIST_DEFAULT_LIMIT,
  JOB_LIST_MAX_LIMIT,
  JOB_LIST_PROMPT_PREVIEW_CHARS,
  parseJobListQuery,
  type JobListQuery,
} from "./job-list-view";

function row(i: number, overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: `job-${i}`,
    owner_email: "owner@example.com",
    session_id: `session-${i}`,
    thread_mode: "same_session",
    name: `Job ${i}`,
    prompt: `prompt ${i} `.repeat(200),
    cadence_secs: 300,
    max_runs: null,
    run_count: i,
    status: "paused",
    next_run_at: "2026-10-05T00:00:00.000Z",
    last_run_at: null,
    last_error: null,
    schedule_id: `sched-${i}`,
    created_at: "2026-07-01 00:00:00",
    updated_at: "2026-07-01 00:00:00",
    ...overrides,
  };
}

function query(overrides: Partial<JobListQuery> = {}): JobListQuery {
  return { limit: JOB_LIST_DEFAULT_LIMIT, offset: 0, includePrompt: false, ...overrides };
}

test("parseJobListQuery applies defaults", () => {
  assert.deepEqual(parseJobListQuery({ action: "list" }), {
    status: undefined, nameContains: undefined, limit: JOB_LIST_DEFAULT_LIMIT, offset: 0, includePrompt: false,
  });
});

test("parseJobListQuery rejects invalid filters instead of silently ignoring them", () => {
  assert.ok("error" in parseJobListQuery({ status: "running" }));
  assert.ok("error" in parseJobListQuery({ limit: 0 }));
  assert.ok("error" in parseJobListQuery({ limit: JOB_LIST_MAX_LIMIT + 1 }));
  assert.ok("error" in parseJobListQuery({ limit: 2.5 }));
  assert.ok("error" in parseJobListQuery({ offset: -1 }));
  assert.ok("error" in parseJobListQuery({ nameContains: 42 }));
});

test("parseJobListQuery trims nameContains and drops blanks", () => {
  const q = parseJobListQuery({ nameContains: "  Lee " });
  assert.ok(!("error" in q));
  assert.equal(q.nameContains, "Lee");
  const blank = parseJobListQuery({ nameContains: "   " });
  assert.ok(!("error" in blank));
  assert.equal(blank.nameContains, undefined);
});

test("reports truncation and nextOffset instead of silently capping at 20", () => {
  const rows = Array.from({ length: 45 }, (_, i) => row(i));
  const view = buildJobListView(rows, query());
  assert.equal(view.returned, 20);
  assert.equal(view.matched, 45);
  assert.equal(view.truncated, true);
  assert.equal(view.nextOffset, 20);
  assert.match(view.coverage, /20 of 45 matching/);

  const last = buildJobListView(rows, query({ offset: 40 }));
  assert.equal(last.returned, 5);
  assert.equal(last.truncated, false);
  assert.equal(last.nextOffset, null);
});

test("filters by status and case-insensitive name in one call", () => {
  const rows = [
    row(1, { name: "Lee sprint closure loop", status: "paused" }),
    row(2, { name: "Monitor LEE glance deploy", status: "active" }),
    row(3, { name: "factory", status: "active" }),
    row(4, { name: "cleanup-lee", status: "exhausted" }),
  ];
  const view = buildJobListView(rows, query({ status: "active", nameContains: "lee" }));
  assert.deepEqual(view.jobs.map((j) => j.id), ["job-2"]);
  assert.equal(view.matched, 1);
  assert.equal(view.scanned, 4);
  assert.equal(view.truncated, false);
  assert.deepEqual(view.filters, { status: "active", nameContains: "lee" });
  assert.match(view.coverage, /1 of 1 matching job\(s\) returned \(status=active, name contains "lee"\); 4 job\(s\) scanned\./);
});

test("an empty result still states coverage", () => {
  const view = buildJobListView([row(1), row(2)], query({ status: "active" }));
  assert.equal(view.returned, 0);
  assert.match(view.coverage, /0 of 0 matching job\(s\) returned \(status=active\); 2 job\(s\) scanned\./);
});

test("slims rows: prompt preview by default, no owner_email or schedule_id", () => {
  const view = buildJobListView([row(1)], query());
  const item = view.jobs[0] as unknown as Record<string, unknown>;
  assert.equal(item.prompt, undefined);
  assert.equal(item.owner_email, undefined);
  assert.equal(item.schedule_id, undefined);
  const previewText = item.prompt_preview as string;
  assert.ok(Array.from(previewText).length <= JOB_LIST_PROMPT_PREVIEW_CHARS + 1);
  assert.ok(previewText.endsWith("…"));
});

test("includePrompt returns the full prompt", () => {
  const r = row(1);
  const view = buildJobListView([r], query({ includePrompt: true }));
  assert.equal(view.jobs[0].prompt, r.prompt);
  assert.equal(view.jobs[0].prompt_preview, undefined);
});

test("flags when the D1 scan cap was reached", () => {
  const rows = Array.from({ length: 5 }, (_, i) => row(i));
  const view = buildJobListView(rows, query(), 5);
  assert.equal(view.scanCapped, true);
  assert.match(view.coverage, /scan cap 5 reached, totals may be incomplete/);
});

test("default page of 20 slim jobs stays far below the model tool-output cap", () => {
  const rows = Array.from({ length: 100 }, (_, i) => row(i));
  const bytes = new TextEncoder().encode(JSON.stringify({ ok: true, result: buildJobListView(rows, query()) })).byteLength;
  assert.ok(bytes < 16_000, `expected < 16000 bytes, got ${bytes}`);
});
