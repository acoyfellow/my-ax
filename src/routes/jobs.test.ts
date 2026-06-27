import assert from "node:assert/strict";
import test from "node:test";
import { parseJobListQuery } from "./jobs";

test("parseJobListQuery accepts active status filter", () => {
  assert.deepEqual(parseJobListQuery("https://my.ax/api/jobs?status=active"), { status: "active" });
});

test("parseJobListQuery accepts paused status filter", () => {
  assert.deepEqual(parseJobListQuery("https://my.ax/api/jobs?status=paused"), { status: "paused" });
});

test("parseJobListQuery keeps status optional", () => {
  assert.deepEqual(parseJobListQuery("https://my.ax/api/jobs"), {});
});

test("parseJobListQuery rejects unsupported statuses", () => {
  assert.deepEqual(parseJobListQuery("https://my.ax/api/jobs?status=deleted"), {
    error: { code: "BAD_JOB_STATUS", message: "Unsupported job status: deleted" },
  });
});
