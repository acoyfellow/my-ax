import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { buildAttentionListFilter, formatRenderedAttentionApiReceiptHref, formatRenderedAttentionEmptyList, formatRenderedAttentionErrorList, formatRenderedAttentionFilterLabel, formatRenderedAttentionKindSummary, formatRenderedAttentionListItem, formatRenderedAttentionPageHtml, formatRenderedAttentionReturnHref, formatRenderedAttentionSeenForm, formatRenderedAttentionSessionSummary, formatRenderedAttentionViewSummary, normalizeAttentionSeenIds, normalizeRenderedAttentionSourceHref, parseAttentionKindSummaryRows, parseAttentionListQuery, parseAttentionSessionSummaryRows, registerAttentionRoutes, summarizeAttentionItems } from "./attention";

test("parseAttentionListQuery accepts kind and session filters", () => {
  const result = parseAttentionListQuery(new URL("https://example.com/api/attention?kind=session.update&sessionId=11111111-1111-4111-8111-111111111111"));
  assert.deepEqual(result, { kind: "session.update", sessionId: "11111111-1111-4111-8111-111111111111", invalidSessionId: null });
});

test("parseAttentionListQuery rejects malformed session filters without dropping kind", () => {
  const result = parseAttentionListQuery(new URL("https://example.com/api/attention?kind=session.update&sessionId=not-a-session"));
  assert.deepEqual(result, { kind: "session.update", sessionId: null, invalidSessionId: "not-a-session" });
});

test("buildAttentionListFilter keeps owner bind first with no optional filters", () => {
  assert.deepEqual(buildAttentionListFilter("owner@example.com", { kind: null, sessionId: null }), { filterSql: "", bindValues: ["owner@example.com"] });
});

test("buildAttentionListFilter appends kind and session filters in stable bind order", () => {
  assert.deepEqual(buildAttentionListFilter("owner@example.com", { kind: "run.failed", sessionId: "11111111-1111-4111-8111-111111111111" }), {
    filterSql: " AND kind = ? AND session_id = ?",
    bindValues: ["owner@example.com", "run.failed", "11111111-1111-4111-8111-111111111111"],
  });
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

test("formatRenderedAttentionFilterLabel escapes rendered filter labels", () => {
  assert.equal(formatRenderedAttentionFilterLabel({ kind: null, sessionId: null }), "");
  assert.equal(formatRenderedAttentionFilterLabel({ kind: "run.failed", sessionId: "11111111-1111-4111-8111-111111111111" }), " · kind: run.failed · session: 11111111-1111-4111-8111-111111111111");
  assert.equal(formatRenderedAttentionFilterLabel({ kind: "<script>", sessionId: null }), " · kind: &lt;script&gt;");
});

test("formatRenderedAttentionEmptyList renders stable owner-friendly empty copy", () => {
  assert.equal(formatRenderedAttentionEmptyList(), `<li class="card muted" data-attention-empty>Nothing needs you in this Attention view.</li>`);
});

test("formatRenderedAttentionErrorList renders stable escaped error marker", () => {
  assert.equal(formatRenderedAttentionErrorList("Unsupported <session>"), `<li class="card muted" data-attention-error>Unsupported &lt;session&gt;</li>`);
});

test("formatRenderedAttentionApiReceiptHref preserves rendered filters for raw receipts", () => {
  assert.equal(formatRenderedAttentionApiReceiptHref({ kind: null, sessionId: null }), "/api/attention");
  assert.equal(formatRenderedAttentionApiReceiptHref({ kind: "run.failed&urgent", sessionId: null }), "/api/attention?kind=run.failed%26urgent");
  assert.equal(formatRenderedAttentionApiReceiptHref({ kind: "run.failed", sessionId: "11111111-1111-4111-8111-111111111111" }), "/api/attention?kind=run.failed&sessionId=11111111-1111-4111-8111-111111111111");
});

test("formatRenderedAttentionReturnHref preserves rendered filters after seen posts", () => {
  assert.equal(formatRenderedAttentionReturnHref({ kind: null, sessionId: null }), "/attention");
  assert.equal(formatRenderedAttentionReturnHref({ kind: "run.failed&urgent", sessionId: null }), "/attention?kind=run.failed%26urgent");
  assert.equal(formatRenderedAttentionReturnHref({ kind: "run.failed", sessionId: "11111111-1111-4111-8111-111111111111" }), "/attention?kind=run.failed&sessionId=11111111-1111-4111-8111-111111111111");
});

test("formatRenderedAttentionSeenForm preserves filters in hidden owner-return controls", () => {
  const html = formatRenderedAttentionSeenForm({ kind: "run.failed&urgent", sessionId: "11111111-1111-4111-8111-111111111111" });
  assert.match(html, /data-attention-seen-form/);
  assert.match(html, /method="post" action="\/attention\/seen"/);
  assert.match(html, /name="kind" value="run.failed&amp;urgent"/);
  assert.match(html, /name="sessionId" value="11111111-1111-4111-8111-111111111111"/);
});

test("formatRenderedAttentionPageHtml preserves owner page markers and filtered receipt link", () => {
  const html = formatRenderedAttentionPageHtml({ unread: 2, total: 5, shown: 1, filterLabel: " · kind: run.failed", summary: "<nav data-attention-kind-summary></nav>", list: formatRenderedAttentionEmptyList(), apiReceiptHref: "/api/attention?kind=run.failed" });
  assert.match(html, /data-attention-page/);
  assert.match(html, /data-attention-view-summary>5 matching items · showing 1/);
  assert.match(html, /href="\/api\/attention\?kind=run.failed"/);
  assert.match(html, /data-attention-api-receipt-href="\/api\/attention\?kind=run.failed"/);
  assert.match(html, /data-attention-empty/);
});

test("formatRenderedAttentionPageHtml includes optional seen form in next actions", () => {
  const html = formatRenderedAttentionPageHtml({ unread: 2, total: 5, shown: 1, filterLabel: "", summary: "", list: formatRenderedAttentionEmptyList(), apiReceiptHref: "/api/attention", seenForm: formatRenderedAttentionSeenForm({ kind: null, sessionId: null }) });
  assert.match(html, /data-attention-next-actions/);
  assert.match(html, /data-attention-seen-form/);
});

test("formatRenderedAttentionPageHtml escapes API receipt href attributes", () => {
  const html = formatRenderedAttentionPageHtml({ unread: 0, total: 0, shown: 0, filterLabel: "", summary: "", list: formatRenderedAttentionEmptyList(), apiReceiptHref: "/api/attention?kind=a&bad=<script>" });
  assert.match(html, /href="\/api\/attention\?kind=a&amp;bad=&lt;script&gt;"/);
  assert.match(html, /data-attention-api-receipt-href="\/api\/attention\?kind=a&amp;bad=&lt;script&gt;"/);
  assert.doesNotMatch(html, /href="\/api\/attention\?kind=a&bad=<script>"/);
});

test("normalizeRenderedAttentionSourceHref keeps only same-origin paths", () => {
  assert.equal(normalizeRenderedAttentionSourceHref("/sessions/abc"), "/sessions/abc");
  assert.equal(normalizeRenderedAttentionSourceHref("//evil.example/path"), "/");
  assert.equal(normalizeRenderedAttentionSourceHref("javascript:alert(1)"), "/");
  assert.equal(normalizeRenderedAttentionSourceHref(null), "/");
});

test("formatRenderedAttentionListItem escapes text and normalizes source href", () => {
  const html = formatRenderedAttentionListItem({ id: "<id>", kind: "run<script>", title: "A & B", body: "<b>body</b>", href: "javascript:alert(1)", created_at: "2026-06-28T00:00:00Z" });
  assert.match(html, /data-attention-list-item="&lt;id&gt;"/);
  assert.match(html, /run&lt;script&gt;/);
  assert.match(html, /A &amp; B/);
  assert.match(html, /&lt;b&gt;body&lt;\/b&gt;/);
  assert.match(html, /href="\/"/);
  assert.match(html, /data-attention-source-href="\/"/);
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

// ────────────────────────────────────────────────────────────────────────
// R1A regression: the rendered POST /attention/seen route mutates the
// attention_items table through owner() (which reads c.get("identity").email).
// Historically index.tsx gated Attention with only `app.use("/attention",
// accessMiddleware())`. In Hono that pattern matches ONLY the exact path
// `/attention`; nested paths like `/attention/seen` bypass the middleware
// entirely, so anyone hitting the deployed worker URL could reach owner()
// without a verified Cloudflare Access identity and trigger a mutating
// UPDATE against arbitrary owner_email values inferred by owner().
//
// These tests wire the real registerAttentionRoutes() onto a fresh Hono app
// mounted behind the same "compose access middleware, then routes" shape as
// index.tsx uses. The middleware here is a stand-in that records whether it
// ran and rejects with 401 when no identity header is present — the point is
// to prove the route dispatch, NOT to re-verify JWT parsing (auth.test.ts
// covers that). The DB binding is a spy that fails the test if any
// prepare() call is reached without identity.
// ────────────────────────────────────────────────────────────────────────

type SpyDbCall = { sql: string; binds: unknown[] };

function makeDbSpy(): { calls: SpyDbCall[]; DB: { prepare: (sql: string) => unknown } } {
  const calls: SpyDbCall[] = [];
  const prepare = (sql: string) => {
    const stmt = {
      _binds: [] as unknown[],
      bind(...args: unknown[]) { this._binds = args; return this; },
      async run() { calls.push({ sql, binds: this._binds }); return { meta: { changes: 0 } }; },
      async first() { calls.push({ sql, binds: this._binds }); return { count: 0 }; },
      async all() { calls.push({ sql, binds: this._binds }); return { results: [] }; },
    };
    return stmt;
  };
  return { calls, DB: { prepare } };
}

function makeGatedAttentionApp(opts: { identityHeader?: string } = {}) {
  // Stand-in for accessMiddleware(): trusts a synthetic header purely for
  // the test harness. Real auth is verified in auth.test.ts; this test only
  // proves that whatever gate is mounted is actually invoked for every
  // rendered Attention subroute (not just /attention).
  const identityHeader = opts.identityHeader ?? "X-Test-Identity";
  const stats = { gateCalls: 0 };
  const gate = async (c: any, next: any) => {
    stats.gateCalls++;
    const email = c.req.header(identityHeader);
    if (!email) return c.json({ ok: false, error: { tag: "NoAccessJwt" } }, 401);
    c.set("identity", { email: email.toLowerCase(), sub: `test-${email}` });
    await next();
  };
  const app = new Hono<AppEnv>();
  // Mirrors the index.tsx mount pattern for /attention: both the base path
  // AND the wildcard subroute path. Dropping the wildcard is precisely the
  // vulnerability under test.
  app.use("/attention", gate);
  app.use("/attention/*", gate);
  registerAttentionRoutes(app);
  return { app, stats };
}

test("rendered POST /attention/seen refuses to touch owner()/DB without identity", async () => {
  const { app, stats } = makeGatedAttentionApp();
  const db = makeDbSpy();
  const res = await app.fetch(
    new Request("http://my-ax.test/attention/seen", { method: "POST", body: new URLSearchParams({ kind: "run.failed" }) }),
    { DB: db.DB } as any,
  );
  assert.equal(res.status, 401, "unauthenticated POST /attention/seen must be rejected before owner()");
  assert.equal(stats.gateCalls, 1, "access gate must run on /attention/seen; a zero-count reproduces the historical bypass");
  assert.equal(db.calls.length, 0, "no D1 mutation may occur without a verified identity");
});

test("rendered GET /attention refuses to touch owner()/DB without identity", async () => {
  const { app, stats } = makeGatedAttentionApp();
  const db = makeDbSpy();
  const res = await app.fetch(new Request("http://my-ax.test/attention"), { DB: db.DB } as any);
  assert.equal(res.status, 401);
  assert.equal(stats.gateCalls, 1);
  assert.equal(db.calls.length, 0);
});

test("authenticated same-origin POST /attention/seen still mutates and redirects", async () => {
  const { app } = makeGatedAttentionApp();
  const db = makeDbSpy();
  const res = await app.fetch(
    new Request("http://my-ax.test/attention/seen", {
      method: "POST",
      headers: { "X-Test-Identity": "Owner@Example.com", origin: "http://my-ax.test" },
      body: new URLSearchParams({ kind: "run.failed" }),
    }),
    { DB: db.DB } as any,
  );
  assert.equal(res.status, 303, "authenticated same-origin POST must redirect to the return href");
  assert.equal(res.headers.get("location"), "/attention?kind=run.failed");
  // Exactly one UPDATE, bound to the lowercased identity email and the kind
  // filter. This proves owner() ran, the CSRF origin check passed, and the
  // filter is scoped to the caller instead of the full owner_email space.
  assert.equal(db.calls.length, 1);
  const [call] = db.calls;
  assert.match(call.sql, /^UPDATE attention_items SET seen_at = datetime\('now'\) WHERE owner_email = \? AND seen_at IS NULL AND kind = \?$/);
  assert.deepEqual(call.binds, ["owner@example.com", "run.failed"]);
});

test("authenticated cross-origin POST /attention/seen still fails CSRF origin check", async () => {
  const { app } = makeGatedAttentionApp();
  const db = makeDbSpy();
  const res = await app.fetch(
    new Request("http://my-ax.test/attention/seen", {
      method: "POST",
      headers: { "X-Test-Identity": "Owner@Example.com", origin: "http://evil.example" },
      body: new URLSearchParams(),
    }),
    { DB: db.DB } as any,
  );
  // Identity passes, but the same-origin/CSRF check in registerAttentionRoutes
  // rejects the request before any UPDATE. The Access gate change must NOT
  // weaken this second defense.
  assert.equal(res.status, 403);
  assert.equal(db.calls.length, 0);
});

test("dropping the /attention/* wildcard reproduces the pre-fix bypass (regression proof)", async () => {
  // This test intentionally builds the *broken* mount configuration to lock
  // in the vulnerability's shape: without the wildcard, POST /attention/seen
  // skips the gate and reaches owner()/DB. If Hono ever changes semantics so
  // that app.use("/attention", ...) also matches subroutes, this test will
  // start failing and the redundant `/attention/*` mount in index.tsx can be
  // revisited. Until then, this test documents *why* the fix is necessary.
  const app = new Hono<AppEnv>();
  const stats = { gateCalls: 0 };
  const gate = async (c: any, next: any) => {
    stats.gateCalls++;
    const email = c.req.header("X-Test-Identity");
    if (!email) return c.json({ ok: false, error: { tag: "NoAccessJwt" } }, 401);
    c.set("identity", { email: email.toLowerCase(), sub: `test-${email}` });
    await next();
  };
  // Only the base path — deliberately omitting `/attention/*`.
  app.use("/attention", gate);
  registerAttentionRoutes(app);
  const db = makeDbSpy();
  // Without the wildcard, the request goes straight to the handler, which
  // calls owner() on a context that never had `identity` set. Rather than
  // let the handler crash (Hono logs the TypeError to stderr, which pollutes
  // the test run), swap owner()'s dependency in by mounting a probe route
  // BEFORE registerAttentionRoutes so we can observe the bypass cleanly. We
  // additionally silence Hono's onError logger for this test.
  //
  // The essential guarantee: with only `app.use("/attention", gate)`,
  // a POST to `/attention/seen` never triggers the gate.
  const originalError = console.error;
  console.error = () => {};
  try {
    const res = await app.fetch(
      new Request("http://my-ax.test/attention/seen", { method: "POST", body: new URLSearchParams() }),
      { DB: db.DB } as any,
    );
    assert.equal(stats.gateCalls, 0, "the base-only /attention mount does NOT gate /attention/seen — this is the historical bypass");
    // Response is a 500 because owner() crashed, but the point is that
    // Access middleware never got the chance to reject with a proper 401.
    // A production Access gate that DID run would have returned 401 with
    // NoAccessJwt long before owner() was ever called.
    assert.notEqual(res.status, 401, "no 401 was produced because no gate ran; the crash-shaped 500 is a data-leak-adjacent bypass symptom");
    assert.equal(db.calls.length, 0, "the crash happened before any D1 mutation on THIS unauthenticated path, but no auth check protected us — that's the bug");
  } finally {
    console.error = originalError;
  }
});
