export type ObserveEvent = { ownerEmail: string; sessionId?: string | null; kind: "step" | "workspace"; name: string; durationMs?: number | null; outcome?: string | null; message?: string | null };

type D1Like = { prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown>; all<T>(): Promise<{ results?: T[] }> } } };

export const OBSERVE_RETENTION_DAYS = 7;

export async function recordObserveEvent(db: D1Like, event: ObserveEvent): Promise<void> {
  await db.prepare("INSERT INTO observe_events(owner_email, session_id, ts, kind, name, duration_ms, outcome, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(event.ownerEmail.toLowerCase(), event.sessionId ?? null, new Date().toISOString(), event.kind, event.name, event.durationMs ?? null, event.outcome ?? null, event.message ? event.message.slice(0, 500) : null).run();
}

export async function pruneObserveEvents(db: D1Like): Promise<void> {
  await db.prepare("DELETE FROM observe_events WHERE ts < ?").bind(new Date(Date.now() - OBSERVE_RETENTION_DAYS * 86_400_000).toISOString()).run();
}

export type ObserveEventRow = { ts: string; session_id: string | null; kind: string; name: string; duration_ms: number | null; outcome: string | null; message: string | null };

export function clampMinutes(value: unknown): number {
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes > 0 ? Math.min(minutes, OBSERVE_RETENTION_DAYS * 1440) : 60;
}

export async function recentObserveEvents(db: D1Like, ownerEmail: string, options: { kind?: string; sinceMinutes?: unknown; sessionId?: string; limit?: number }): Promise<ObserveEventRow[]> {
  const since = new Date(Date.now() - clampMinutes(options.sinceMinutes) * 60_000).toISOString();
  const kind = options.kind === "step" || options.kind === "workspace" ? options.kind : null;
  const rows = await db.prepare(
    "SELECT ts, session_id, kind, name, duration_ms, outcome, message FROM observe_events WHERE owner_email = ? AND ts >= ? AND (? IS NULL OR kind = ?) AND (? IS NULL OR session_id = ?) ORDER BY id DESC LIMIT ?",
  ).bind(ownerEmail.toLowerCase(), since, kind, kind, options.sessionId ?? null, options.sessionId ?? null, Math.min(Math.max(options.limit ?? 100, 1), 500)).all<ObserveEventRow>();
  return rows.results ?? [];
}
