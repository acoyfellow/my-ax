import { DESK_PREFERENCE_KEY, emptyDeskBoard, parseDeskBoard, type DeskBoard } from "./desk-board";

export type DeskBoardDb = { DB: Pick<D1Database, "prepare"> };

export async function readVersionedBoard(env: DeskBoardDb, email: string): Promise<{ value: DeskBoard; version: string | null }> {
  const row = await env.DB.prepare("SELECT value_json, updated_at FROM owner_preferences WHERE owner_email = ? AND preference_key = ?")
    .bind(email, DESK_PREFERENCE_KEY).first<{ value_json: string; updated_at: string }>();
  if (!row?.value_json) return { value: emptyDeskBoard(), version: null };
  let value: DeskBoard;
  try { value = parseDeskBoard(JSON.parse(row.value_json)); } catch { value = emptyDeskBoard(); }
  return { value, version: row.value_json };
}

export async function compareAndSetBoard(env: DeskBoardDb, email: string, board: DeskBoard, expectedVersion: string | null): Promise<boolean> {
  const now = new Date().toISOString();
  const payload = JSON.stringify(board);
  if (expectedVersion === null) {
    const inserted = await env.DB.prepare(`INSERT INTO owner_preferences(owner_email, preference_key, value_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner_email, preference_key) DO NOTHING`)
      .bind(email, DESK_PREFERENCE_KEY, payload, now, now).run();
    return (inserted.meta?.changes ?? 0) > 0;
  }
  const updated = await env.DB.prepare(`UPDATE owner_preferences SET value_json = ?, updated_at = ?
    WHERE owner_email = ? AND preference_key = ? AND value_json = ?`)
    .bind(payload, now, email, DESK_PREFERENCE_KEY, expectedVersion).run();
  return (updated.meta?.changes ?? 0) > 0;
}
