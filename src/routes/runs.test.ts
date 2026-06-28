import assert from "node:assert/strict";
import test from "node:test";
import { formatRenderedRunsApiReceiptHref, parseRunListQuery } from "./runs";

test("parseRunListQuery accepts a supported status filter", () => {
  const result = parseRunListQuery(new URL("https://example.com/api/runs?status=failed&limit=250"));
  assert.deepEqual(result, { limit: 100, status: "failed", invalidStatus: null });
});

test("parseRunListQuery reports unsupported status filters", () => {
  const result = parseRunListQuery(new URL("https://example.com/api/runs?status=stuck&limit=0"));
  assert.deepEqual(result, { limit: 1, status: null, invalidStatus: "stuck" });
});

test("parseRunListQuery keeps status optional", () => {
  const result = parseRunListQuery(new URL("https://example.com/api/runs"));
  assert.deepEqual(result, { limit: 25, status: null, invalidStatus: null });
});

test("formatRenderedRunsApiReceiptHref preserves active rendered status filters", () => {
  assert.equal(formatRenderedRunsApiReceiptHref("failed"), "/api/runs?status=failed");
  assert.equal(formatRenderedRunsApiReceiptHref("open"), "/api/runs?status=open");
  assert.equal(formatRenderedRunsApiReceiptHref(null), "/api/runs");
});
