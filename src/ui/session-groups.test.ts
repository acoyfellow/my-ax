import { test } from "node:test";
import assert from "node:assert/strict";
import { groupByTime, matchesTitle, runStateOf, timeGroupOf } from "./session-groups";

const now = new Date(2026, 9, 16, 15, 0, 0);

test("rows fall into Today, Yesterday, Last 7 days and Older by calendar day", () => {
  assert.equal(timeGroupOf(new Date(2026, 9, 16, 0, 5), now), "Today");
  assert.equal(timeGroupOf(new Date(2026, 9, 15, 23, 59), now), "Yesterday");
  assert.equal(timeGroupOf(new Date(2026, 9, 10, 9, 0), now), "Last 7 days");
  assert.equal(timeGroupOf(new Date(2026, 9, 9, 9, 0), now), "Older");
  assert.equal(timeGroupOf(null, now), "Older");
});

test("groups keep row order and drop empty groups", () => {
  const rows = [
    { id: "a", at: new Date(2026, 9, 16, 9) },
    { id: "b", at: new Date(2026, 8, 1) },
    { id: "c", at: new Date(2026, 9, 16, 8) },
  ];
  assert.deepEqual(groupByTime(rows, (row) => row.at, now).map(({ group, rows: items }) => [group, items.map((row) => row.id)]), [["Today", ["a", "c"]], ["Older", ["b"]]]);
});

test("search filters by title, case-insensitively, and an empty query keeps everything", () => {
  assert.equal(matchesTitle("Hark build", "HARK"), true);
  assert.equal(matchesTitle("Hark build", "coil"), false);
  assert.equal(matchesTitle("anything", "  "), true);
});

test("run state is working, failed or idle", () => {
  assert.equal(runStateOf("running"), "working");
  assert.equal(runStateOf("error"), "failed");
  assert.equal(runStateOf("offline"), "idle");
  assert.equal(runStateOf("idle"), "idle");
});
