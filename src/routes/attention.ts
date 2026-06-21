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

export function registerAttentionRoutes(app: Hono<AppEnv>) {
  app.get("/api/attention", async (c) => {
    const email = owner(c);
    const [items, unread] = await Promise.all([
      c.env.DB.prepare(`SELECT id, session_id, kind, title, body, href, created_at, seen_at
        FROM attention_items WHERE owner_email = ? ORDER BY created_at DESC LIMIT 20`).bind(email).all<AttentionRow>(),
      c.env.DB.prepare("SELECT COUNT(*) AS count FROM attention_items WHERE owner_email = ? AND seen_at IS NULL").bind(email).first<{ count: number }>(),
    ]);
    return c.json<ApiResponse>({ ok: true, command: c.req.path, result: { unread: Number(unread?.count ?? 0), items: items.results ?? [] }, next_actions: [] });
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
    const ids = [...new Set((body.ids ?? []).filter((id: string) => /^[0-9a-f-]{36}$/i.test(id)))].slice(0, 50);
    if (ids.length) {
      const placeholders = ids.map(() => "?").join(",");
      await c.env.DB.prepare(`UPDATE attention_items SET seen_at = datetime('now') WHERE owner_email = ? AND seen_at IS NULL AND id IN (${placeholders})`).bind(email, ...ids).run();
    } else if (!hasExplicitIds) {
      await c.env.DB.prepare("UPDATE attention_items SET seen_at = datetime('now') WHERE owner_email = ? AND seen_at IS NULL").bind(email).run();
    }
    const unread = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM attention_items WHERE owner_email = ? AND seen_at IS NULL").bind(email).first<{ count: number }>();
    return c.json<ApiResponse>({ ok: true, command: c.req.path, result: { unread: Number(unread?.count ?? 0) }, next_actions: [] });
  });
}
