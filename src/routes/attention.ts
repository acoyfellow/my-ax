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

export function normalizeAttentionSeenIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)))].slice(0, 50);
}

export function registerAttentionRoutes(app: Hono<AppEnv>) {
  app.get("/api/attention", async (c) => {
    const email = owner(c);
    const [items, unread] = await Promise.all([
      c.env.DB.prepare(`SELECT id, session_id, kind, title, body, href, created_at, seen_at
        FROM attention_items WHERE owner_email = ? ORDER BY created_at DESC LIMIT 20`).bind(email).all<AttentionRow>(),
      c.env.DB.prepare("SELECT COUNT(*) AS count FROM attention_items WHERE owner_email = ? AND seen_at IS NULL").bind(email).first<{ count: number }>(),
    ]);
    const rows = items.results ?? [];
    return c.json<ApiResponse>({ ok: true, command: c.req.path, result: { unread: Number(unread?.count ?? 0), items: rows, summary: summarizeAttentionItems(rows) }, next_actions: [] });
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
