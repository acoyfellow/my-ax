import assert from "node:assert/strict";
import test from "node:test";
import { formatRenderedAttentionKindSummary, formatRenderedAttentionSessionSummary, formatRenderedAttentionViewSummary, normalizeAttentionSeenIds, parseAttentionKindSummaryRows, parseAttentionListQuery, parseAttentionSessionSummaryRows, summarizeAttentionItems } from "./attention";

test("parseAttentionListQuery accepts kind and session filters", () => {
  const result = parseAttentionListQuery(new URL("https://example.com/api/attention?kind=session.update&sessionId=11111111-1111-4111-8111-111111111111"));
  assert.deepEqual(result, { kind: "session.update", sessionId: "11111111-1111-4111-8111-111111111111", invalidSessionId: null });
});

test("parseAttentionListQuery rejects malformed session filters without dropping kind", () => {
  const result = parseAttentionListQuery(new URL("https://example.com/api/attention?kind=session.update&sessionId=not-a-session"));
  assert.deepEqual(result, { kind: "session.update", sessionId: null, invalidSessionId: "not-a-session" });
});

test("normalizeAttentionSeenIds keeps unique UUIDs in request order", () => {
  const one = "11111111-1111-4111-8111-111111111111";
  const two = "22222222-2222-4222-8222-222222222222";
  assert.deepEqual(normalizeAttentionSeenIds([one, "not-a-uuid", two, one, 42]), [one, two]);
});

test("normalizeAttentionSeenIds caps explicit acknowledgements", () => {
  const ids = Array.from({ length: 60 }, (_, i) => `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`);
  const normalized = normalizeAttentionSeenIds(ids);
  assert.equal(normalized.length, 50);
  assert.equal(normalized[0], "00000000-1111-4111-8111-111111111111");
  assert.equal(normalized[49], "00000049-1111-4111-8111-111111111111");
});

test("normalizeAttentionSeenIds treats absent or malformed ids as empty explicit set", () => {
  assert.deepEqual(normalizeAttentionSeenIds(undefined), []);
  assert.deepEqual(normalizeAttentionSeenIds("11111111-1111-4111-8111-111111111111"), []);
});

test("summarizeAttentionItems groups unread items by kind and session", () => {
  const items = [
    { id: "1", session_id: "s1", kind: "session.update", title: "A", body: "", href: "/", created_at: "2026-06-27T10:00:00Z", seen_at: null },
    { id: "2", session_id: "s1", kind: "session.update", title: "B", body: "", href: "/", created_at: "2026-06-27T11:00:00Z", seen_at: null },
    { id: "3", session_id: "s2", kind: "run.failed", title: "C", body: "", href: "/", created_at: "2026-06-27T12:00:00Z", seen_at: null },
    { id: "4", session_id: "s3", kind: "run.failed", title: "D", body: "", href: "/", created_at: "2026-06-27T13:00:00Z", seen_at: "2026-06-27T14:00:00Z" },
  ];
  assert.deepEqual(summarizeAttentionItems(items).byKind, [
    { kind: "session.update", unread: 2, latest_at: "2026-06-27T11:00:00Z" },
    { kind: "run.failed", unread: 1, latest_at: "2026-06-27T12:00:00Z" },
  ]);
  assert.deepEqual(summarizeAttentionItems(items).bySession, [
    { session_id: "s1", unread: 2, latest_at: "2026-06-27T11:00:00Z" },
    { session_id: "s2", unread: 1, latest_at: "2026-06-27T12:00:00Z" },
  ]);
});

test("summarizeAttentionItems caps session groups", () => {
  const items = Array.from({ length: 12 }, (_, i) => ({
    id: String(i),
    session_id: `s${i}`,
    kind: "session.update",
    title: "A",
    body: "",
    href: "/",
    created_at: `2026-06-27T10:${String(i).padStart(2, "0")}:00Z`,
    seen_at: null,
  }));
  assert.equal(summarizeAttentionItems(items).bySession.length, 10);
});

test("parseAttentionKindSummaryRows normalizes exact grouped SQL rows", () => {
  assert.deepEqual(parseAttentionKindSummaryRows([
    { kind: "session.update", unread: 12, latest_at: "2026-06-27 21:15:42" },
    { kind: null, unread: 2, latest_at: null },
  ]), [
    { kind: "session.update", unread: 12, latest_at: "2026-06-27 21:15:42" },
    { kind: "unknown", unread: 2, latest_at: null },
  ]);
});

test("formatRenderedAttentionViewSummary states exact total and shown count", () => {
  assert.equal(formatRenderedAttentionViewSummary(72, 50), "72 matching items · showing 50");
  assert.equal(formatRenderedAttentionViewSummary(null, "bad"), "0 matching items · showing 0");
});

test("formatRenderedAttentionKindSummary renders filtered links and all-clear copy", () => {
  const html = formatRenderedAttentionKindSummary([{ kind: "run.failed&urgent", count: 2 }]);
  assert.match(html, /data-attention-kind-summary/);
  assert.match(html, /href="\/attention\?kind=run\.failed%26urgent"/);
  assert.match(html, /<strong>2<\/strong> run\.failed&amp;urgent/);
  assert.match(formatRenderedAttentionKindSummary([]), /data-attention-kind-summary-empty>0 unread groups/);
});

test("formatRenderedAttentionSessionSummary renders filtered links and all-clear copy", () => {
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const html = formatRenderedAttentionSessionSummary([{ sessionId, count: 3 }]);
  assert.match(html, /data-attention-session-summary/);
  assert.match(html, new RegExp(`href="/attention\\?sessionId=${sessionId}"`));
  assert.match(html, /<strong>3<\/strong> session 11111111/);
  assert.match(formatRenderedAttentionSessionSummary([]), /data-attention-session-summary-empty>0 unread sessions/);
});

test("parseAttentionSessionSummaryRows normalizes exact grouped SQL rows", () => {
  assert.deepEqual(parseAttentionSessionSummaryRows([
    { session_id: "s1", unread: 3, latest_at: "2026-06-27 21:15:42" },
    { session_id: null, unread: 1, latest_at: null },
  ]), [
    { session_id: "s1", unread: 3, latest_at: "2026-06-27 21:15:42" },
    { session_id: null, unread: 1, latest_at: null },
  ]);
});
