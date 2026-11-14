import { decide } from "../decide";
import { CreateWidget } from "./CreateWidget.command";
import { DeleteWidget } from "./DeleteWidget.command";
import { UpdateWidget } from "./UpdateWidget.command";
import { Widget } from "./Widget.aggregate";

type Statement = { run(): Promise<{ meta?: { changes?: number } }>; first<T>(): Promise<T | null>; all<T>(): Promise<{ results?: T[] }> };
export type WidgetDb = { prepare(sql: string): { bind(...values: unknown[]): Statement } };

type Row = { title: string; source_hash: string; library_saved: number };

async function load(db: WidgetDb, owner: string, id: string) {
  const row = await db.prepare("SELECT title, source_hash, library_saved FROM artifacts WHERE id = ? AND owner_email = ?").bind(id, owner).first<Row>();
  return row
    ? { _tag: "Present" as const, ownerEmail: owner, title: row.title, sourceHash: row.source_hash ?? "", librarySaved: Boolean(row.library_saved) }
    : { _tag: "Missing" as const };
}

export async function createWidgetRecord(db: WidgetDb, row: {
  id: string; owner: string; sessionId: string; kind: string; title: string; storageKey: string; sourceHash: string; createdAt: string;
}): Promise<void> {
  decide(Widget, row.id, { _tag: "Missing" }, new CreateWidget({ ownerEmail: row.owner, title: row.title, sourceHash: row.sourceHash, librarySaved: false }));
  await db.prepare("INSERT INTO artifacts (id, owner_email, session_id, kind, title, storage_key, source_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(row.id, row.owner, row.sessionId, row.kind, row.title, row.storageKey, row.sourceHash, row.createdAt).run();
}

async function update(db: WidgetDb, owner: string, id: string, change: (current: { title: string; sourceHash: string; librarySaved: boolean }) => { title: string; sourceHash: string; librarySaved: boolean }) {
  const state = await load(db, owner, id);
  if (state._tag !== "Present") return false;
  const next = change({ title: state.title, sourceHash: state.sourceHash, librarySaved: state.librarySaved });
  decide(Widget, id, state, new UpdateWidget({ title: next.title, sourceHash: next.sourceHash, librarySaved: next.librarySaved }));
  return true;
}

export async function setWidgetSourceHash(db: WidgetDb, owner: string, id: string, sourceHash: string, updatedAt: string): Promise<void> {
  if (!(await update(db, owner, id, (current) => ({ ...current, sourceHash })))) return;
  await db.prepare("UPDATE artifacts SET source_hash = ?, updated_at = ? WHERE id = ? AND owner_email = ?").bind(sourceHash, updatedAt, id, owner).run();
}

export async function setWidgetTitle(db: WidgetDb, owner: string, id: string, title: string, updatedAt: string): Promise<boolean> {
  if (!(await update(db, owner, id, (current) => ({ ...current, title })))) return false;
  const result = await db.prepare("UPDATE artifacts SET title = ?, updated_at = ? WHERE id = ? AND owner_email = ?").bind(title, updatedAt, id, owner).run();
  return Number(result.meta?.changes ?? 0) > 0;
}

export async function deleteWidgetRecord(db: WidgetDb, owner: string, id: string): Promise<void> {
  decide(Widget, id, await load(db, owner, id), new DeleteWidget());
  await db.prepare("DELETE FROM artifacts WHERE id = ? AND owner_email = ?").bind(id, owner).run();
}

export async function deleteUnsavedSessionWidgets(db: WidgetDb, owner: string, sessionId: string): Promise<string[]> {
  const result = await db.prepare("SELECT id, title, source_hash, storage_key FROM artifacts WHERE session_id = ? AND owner_email = ? AND library_saved = 0")
    .bind(sessionId, owner).all<{ id: string; title: string; source_hash: string; storage_key: string }>();
  const rows = result.results ?? [];
  for (const row of rows) {
    decide(Widget, row.id, { _tag: "Present", ownerEmail: owner, title: row.title, sourceHash: row.source_hash ?? "", librarySaved: false }, new DeleteWidget());
  }
  await db.prepare("DELETE FROM artifacts WHERE session_id = ? AND owner_email = ? AND library_saved = 0").bind(sessionId, owner).run();
  return rows.map((row) => row.storage_key);
}
