import { DESK_PREFERENCE_KEY, emptyDeskBoard, parseDeskBoard, type DeskBoard } from "./desk-board";
import { swapPreference, type PreferenceDb } from "./domain/OwnerPreference/OwnerPreference.store";

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
  return swapPreference(env.DB as unknown as PreferenceDb, email, DESK_PREFERENCE_KEY, JSON.stringify(board), new Date().toISOString(), expectedVersion);
}
