import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import type { ApiResponse } from "../types";

interface AttentionRow {
  id: string;
  session_id: string | null;
  kind: string;
  title: string;
  body: string;
  href: string;
  created_at: string;
  seen_at: string | null;
}

function owner(c: any): string {
  return c.get("identity").email.toLowerCase();
}

type AttentionKindSummary = { kind: string; unread: number; latest_at: string | null };
type AttentionSessionSummary = { session_id: string | null; unread: number; latest_at: string | null };

export function summarizeAttentionItems(items: AttentionRow[]) {
  const unreadItems = items.filter((item) => item.seen_at === null);
  const byKind = new Map<string, { kind: string; unread: number; latest_at: string | null }>();
  const bySession = new Map<string, { session_id: string | null; unread: number; latest_at: string | null }>();
  for (const item of unreadItems) {
    const kind = item.kind || "unknown";
    const kindSummary = byKind.get(kind) ?? { kind, unread: 0, latest_at: null };
    kindSummary.unread += 1;
    kindSummary.latest_at = !kindSummary.latest_at || item.created_at > kindSummary.latest_at ? item.created_at : kindSummary.latest_at;
    byKind.set(kind, kindSummary);

    const sessionKey = item.session_id ?? "__none__";
    const sessionSummary = bySession.get(sessionKey) ?? { session_id: item.session_id, unread: 0, latest_at: null };
    sessionSummary.unread += 1;
    sessionSummary.latest_at = !sessionSummary.latest_at || item.created_at > sessionSummary.latest_at ? item.created_at : sessionSummary.latest_at;
    bySession.set(sessionKey, sessionSummary);
  }
  const sortSummary = <T extends { unread: number; latest_at: string | null }>(values: T[]) => values.sort((a, b) => b.unread - a.unread || String(b.latest_at ?? "").localeCompare(String(a.latest_at ?? "")));
  return {
    byKind: sortSummary([...byKind.values()]),
    bySession: sortSummary([...bySession.values()]).slice(0, 10),
  };
}

export function parseAttentionKindSummaryRows(rows: Array<{ kind: string | null; unread: number; latest_at: string | null }>): AttentionKindSummary[] {
  return rows.map((row) => ({ kind: row.kind || "unknown", unread: Number(row.unread ?? 0), latest_at: row.latest_at ?? null }));
}

export function parseAttentionSessionSummaryRows(rows: Array<{ session_id: string | null; unread: number; latest_at: string | null }>): AttentionSessionSummary[] {
  return rows.map((row) => ({ session_id: row.session_id ?? null, unread: Number(row.unread ?? 0), latest_at: row.latest_at ?? null }));
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[char] ?? char);
}

export function formatRenderedAttentionViewSummary(total: unknown, shown: unknown): string {
  return `${Math.max(0, Number(total ?? 0) || 0)} matching items · showing ${Math.max(0, Number(shown ?? 0) || 0)}`;
}

export function formatRenderedAttentionKindSummary(rows: Array<{ kind: string; count: unknown }>): string {
  const links = rows.map((row) => `<a class="button outline" href="/attention?kind=${encodeURIComponent(row.kind)}"><strong>${Math.max(0, Number(row.count ?? 0) || 0)}</strong> ${escapeHtml(row.kind)}</a>`).join("");
  return `<nav class="actions" data-attention-kind-summary>${links || `<span class="button outline" data-attention-kind-summary-empty>0 unread groups</span>`}</nav>`;
}

export function formatRenderedAttentionSessionSummary(rows: Array<{ sessionId: string; count: unknown }>): string {
  const links = rows.map((row) => `<a class="button outline" href="/attention?sessionId=${encodeURIComponent(row.sessionId)}"><strong>${Math.max(0, Number(row.count ?? 0) || 0)}</strong> session ${escapeHtml(row.sessionId.slice(0, 8))}</a>`).join("");
  return `<nav class="actions" data-attention-session-summary>${links || `<span class="button outline" data-attention-session-summary-empty>0 unread sessions</span>`}</nav>`;
}

export function normalizeRenderedAttentionSourceHref(href: unknown): string {
  const value = String(href ?? "").trim();
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export function formatRenderedAttentionListItem(item: { id: string; kind: string | null; title: string; body: string; href: string | null; created_at: string }): string {
  return `<li class="card" data-attention-list-item="${escapeHtml(item.id)}"><div class="meta">${escapeHtml(item.kind || "attention")} · ${escapeHtml(item.created_at)}</div><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.body)}</p><p><a class="button" href="${escapeHtml(normalizeRenderedAttentionSourceHref(item.href))}">Open source</a> <code>${escapeHtml(item.id)}</code></p></li>`;
}

export function formatRenderedAttentionFilterLabel(query: { kind: string | null; sessionId: string | null }): string {
  const parts = [query.kind ? `kind: ${query.kind}` : null, query.sessionId ? `session: ${query.sessionId}` : null].filter(Boolean);
  return parts.length ? ` · ${escapeHtml(parts.join(" · "))}` : "";
}

export function formatRenderedAttentionEmptyList(): string {
  return `<li class="card muted" data-attention-empty>Nothing needs you in this Attention view.</li>`;
}

export function formatRenderedAttentionApiReceiptHref(query: { kind: string | null; sessionId: string | null }): string {
  const params = new URLSearchParams();
  if (query.kind) params.set("kind", query.kind);
  if (query.sessionId) params.set("sessionId", query.sessionId);
  const suffix = params.toString();
  return suffix ? `/api/attention?${suffix}` : "/api/attention";
}

export function formatRenderedAttentionPageHtml(input: { unread: unknown; total: unknown; shown: number; filterLabel: string; summary: string; list: string; apiReceiptHref: string }): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Attention · my · ax</title><link rel="stylesheet" href="/static/styles.css"><style>body{margin:0;background:#0b1118;color:#e9e9ec;font-family:Inter,ui-sans-serif,system-ui,sans-serif}.wrap{max-width:900px;margin:0 auto;padding:24px}.hero,.card{border:1px solid #27272a;background:#111827;border-radius:18px;padding:16px}.hero{display:flex;justify-content:space-between;gap:16px;align-items:start;margin-bottom:16px}a{color:#f6821f}.muted,.meta,code{color:#a1a1aa}ol{list-style:none;padding:0;margin:0;display:grid;gap:12px}.button{display:inline-block;border-radius:999px;background:#f6821f;color:white;text-decoration:none;font-weight:700;padding:8px 12px;font-size:12px}.outline{border:1px solid #27272a;background:transparent;color:#e9e9ec}.actions{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 16px}h1{margin:.25rem 0 0;font-size:28px}h2{font-size:16px;margin:.35rem 0}.meta{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em}p{line-height:1.55}</style></head><body><main class="wrap" data-attention-page><section class="hero"><div><a href="/">← Back to shell</a><h1>Attention</h1><p class="muted">${Number(input.unread ?? 0)} unread${input.filterLabel}</p><p class="muted" data-attention-view-summary>${formatRenderedAttentionViewSummary(input.total, input.shown)}</p></div><a href="${input.apiReceiptHref}" class="button">API receipt</a></section>${input.summary}<nav class="actions" data-attention-next-actions><a class="button outline" href="/">Back to Check-in</a><a class="button outline" href="/attention">View all attention</a><a class="button outline" href="${input.apiReceiptHref}">API receipt</a></nav><ol>${input.list}</ol></main></body></html>`;
}

export function parseAttentionListQuery(url: URL) {
  const kind = url.searchParams.get("kind")?.trim() || null;
  const sessionParam = url.searchParams.get("sessionId")?.trim() || null;
  const sessionId = sessionParam && /^[0-9a-f-]{36}$/i.test(sessionParam) ? sessionParam : null;
  return { kind, sessionId, invalidSessionId: sessionParam !== null && sessionId === null ? sessionParam : null };
}

export function buildAttentionListFilter(ownerEmail: string, query: { kind: string | null; sessionId: string | null }) {
  const filters: string[] = [];
  const bindValues: string[] = [ownerEmail];
  if (query.kind) {
    filters.push("kind = ?");
    bindValues.push(query.kind);
  }
  if (query.sessionId) {
    filters.push("session_id = ?");
    bindValues.push(query.sessionId);
  }
  return { filterSql: filters.length ? ` AND ${filters.join(" AND ")}` : "", bindValues };
}

export function normalizeAttentionSeenIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)))].slice(0, 50);
}

export function registerAttentionRoutes(app: Hono<AppEnv>) {
  app.get("/attention", async (c) => {
    const email = owner(c);
    const query = parseAttentionListQuery(new URL(c.req.url));
    if (query.invalidSessionId) return c.redirect("/attention", 302);
    const { filterSql, bindValues } = buildAttentionListFilter(email, query);
    const [items, unread, total, kindRows, sessionRows] = await Promise.all([
      c.env.DB.prepare(`SELECT id, session_id, kind, title, body, href, created_at, seen_at FROM attention_items WHERE owner_email = ?${filterSql} ORDER BY created_at DESC LIMIT 50`).bind(...bindValues).all(),
      c.env.DB.prepare(`SELECT COUNT(*) AS count FROM attention_items WHERE owner_email = ? AND seen_at IS NULL${filterSql}`).bind(...bindValues).first<{ count: number }>(),
      c.env.DB.prepare(`SELECT COUNT(*) AS count FROM attention_items WHERE owner_email = ?${filterSql}`).bind(...bindValues).first<{ count: number }>(),
      c.env.DB.prepare("SELECT COALESCE(kind, 'attention') AS kind, COUNT(*) AS count FROM attention_items WHERE owner_email = ? AND seen_at IS NULL GROUP BY COALESCE(kind, 'attention') ORDER BY count DESC, kind ASC LIMIT 8").bind(email).all<{ kind: string; count: number }>(),
      c.env.DB.prepare("SELECT session_id AS sessionId, COUNT(*) AS count FROM attention_items WHERE owner_email = ? AND seen_at IS NULL AND session_id IS NOT NULL GROUP BY session_id ORDER BY count DESC, session_id ASC LIMIT 8").bind(email).all<{ sessionId: string; count: number }>(),
    ]);
    const rows = (items.results ?? []) as Array<{ id: string; kind: string | null; title: string; body: string; href: string; created_at: string }>;
    const summary = `${formatRenderedAttentionKindSummary(kindRows.results ?? [])}${formatRenderedAttentionSessionSummary(sessionRows.results ?? [])}`;
    const list = rows.length ? rows.map(formatRenderedAttentionListItem).join("") : formatRenderedAttentionEmptyList();
    const filterLabel = formatRenderedAttentionFilterLabel(query);
    const apiReceiptHref = formatRenderedAttentionApiReceiptHref(query);
    return c.html(formatRenderedAttentionPageHtml({ unread: unread?.count, total: total?.count, shown: rows.length, filterLabel, summary, list, apiReceiptHref }));
  });

  app.get("/api/attention", async (c) => {
    const email = owner(c);
    const query = parseAttentionListQuery(new URL(c.req.url));
    if (query.invalidSessionId) {
      return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "BAD_ATTENTION_SESSION", message: `unsupported sessionId: ${query.invalidSessionId}` }, next_actions: [] }, 400);
    }
    const { filterSql, bindValues } = buildAttentionListFilter(email, query);
    const [items, unread, kindSummary, sessionSummary] = await Promise.all([
      c.env.DB.prepare(`SELECT id, session_id, kind, title, body, href, created_at, seen_at
        FROM attention_items WHERE owner_email = ?${filterSql} ORDER BY created_at DESC LIMIT 20`).bind(...bindValues).all<AttentionRow>(),
      c.env.DB.prepare(`SELECT COUNT(*) AS count FROM attention_items WHERE owner_email = ? AND seen_at IS NULL${filterSql}`).bind(...bindValues).first<{ count: number }>(),
      c.env.DB.prepare(`SELECT kind, COUNT(*) AS unread, MAX(created_at) AS latest_at
        FROM attention_items WHERE owner_email = ? AND seen_at IS NULL${filterSql}
        GROUP BY kind ORDER BY unread DESC, latest_at DESC LIMIT 20`).bind(...bindValues).all<{ kind: string | null; unread: number; latest_at: string | null }>(),
      c.env.DB.prepare(`SELECT session_id, COUNT(*) AS unread, MAX(created_at) AS latest_at
        FROM attention_items WHERE owner_email = ? AND seen_at IS NULL${filterSql}
        GROUP BY session_id ORDER BY unread DESC, latest_at DESC LIMIT 10`).bind(...bindValues).all<{ session_id: string | null; unread: number; latest_at: string | null }>(),
    ]);
    const rows = items.results ?? [];
    return c.json<ApiResponse>({ ok: true, command: c.req.path, result: {
      unread: Number(unread?.count ?? 0),
      items: rows,
      filter: { kind: query.kind, sessionId: query.sessionId },
      summary: {
        byKind: parseAttentionKindSummaryRows(kindSummary.results ?? []),
        bySession: parseAttentionSessionSummaryRows(sessionSummary.results ?? []),
        sample: summarizeAttentionItems(rows),
      },
    }, next_actions: [] });
  });

  app.delete("/api/attention", async (c) => {
    const email = owner(c);
    const result = await c.env.DB.prepare("DELETE FROM attention_items WHERE owner_email = ?").bind(email).run();
    return c.json<ApiResponse>({
      ok: true,
      command: c.req.path,
      result: { deleted: Number(result.meta?.changes ?? 0), unread: 0, items: [] },
      next_actions: [],
    });
  });

  app.post("/api/attention/seen", async (c) => {
    const email = owner(c);
    const body: { ids?: string[] } = await c.req.json<{ ids?: string[] }>().catch(() => ({}));
    const hasExplicitIds = Array.isArray(body.ids);
    const ids = normalizeAttentionSeenIds(body.ids);
    let seen = 0;
    if (ids.length) {
      const placeholders = ids.map(() => "?").join(",");
      const result = await c.env.DB.prepare(`UPDATE attention_items SET seen_at = datetime('now') WHERE owner_email = ? AND seen_at IS NULL AND id IN (${placeholders})`).bind(email, ...ids).run();
      seen = Number(result.meta?.changes ?? 0);
    } else if (!hasExplicitIds) {
      const result = await c.env.DB.prepare("UPDATE attention_items SET seen_at = datetime('now') WHERE owner_email = ? AND seen_at IS NULL").bind(email).run();
      seen = Number(result.meta?.changes ?? 0);
    }
    const unread = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM attention_items WHERE owner_email = ? AND seen_at IS NULL").bind(email).first<{ count: number }>();
    return c.json<ApiResponse>({ ok: true, command: c.req.path, result: { seen, unread: Number(unread?.count ?? 0) }, next_actions: [] });
  });
}
