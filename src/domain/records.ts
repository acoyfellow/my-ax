import { AudioMessage } from "./AudioMessage/AudioMessage.aggregate";
import { CreateAudioMessage } from "./AudioMessage/CreateAudioMessage.command";
import { DeleteAudioMessage } from "./AudioMessage/DeleteAudioMessage.command";
import { BrowserRecording } from "./BrowserRecording/BrowserRecording.aggregate";
import { CreateBrowserRecording } from "./BrowserRecording/CreateBrowserRecording.command";
import { UpdateBrowserRecording } from "./BrowserRecording/UpdateBrowserRecording.command";
import { decide } from "./decide";
import { CreateEmail } from "./Email/CreateEmail.command";
import { Email } from "./Email/Email.aggregate";
import { CreateSnippet } from "./Snippet/CreateSnippet.command";
import { Snippet } from "./Snippet/Snippet.aggregate";
import { UpdateSnippet } from "./Snippet/UpdateSnippet.command";
import { CreateWorkspaceSnapshot } from "./WorkspaceSnapshot/CreateWorkspaceSnapshot.command";
import { UpdateWorkspaceSnapshot } from "./WorkspaceSnapshot/UpdateWorkspaceSnapshot.command";
import { WorkspaceSnapshot } from "./WorkspaceSnapshot/WorkspaceSnapshot.aggregate";

type Statement = { run(): Promise<unknown>; first<T>(): Promise<T | null>; all<T>(): Promise<{ results?: T[] }> };
export type RecordDb = { prepare(sql: string): { bind(...values: unknown[]): Statement } };

const present = (ownerEmail: string, fields: Record<string, unknown>) => ({ _tag: "Present", ownerEmail, ...fields });
const missing = { _tag: "Missing" } as const;

export async function saveSnippetProjection(db: RecordDb, input: {
  existingId: string | null;
  id: string;
  owner: string;
  name: string;
  description: string;
  code: string;
  inputSchemaJson: string;
  connectorsJson: string;
  sourceRecipeId: string;
  savedAt: number;
  codemodeExecutionId: string;
  now: string;
}): Promise<void> {
  if (input.existingId) {
    decide(Snippet, input.existingId, present(input.owner, { name: input.name, body: input.code }), new UpdateSnippet({ name: input.name, body: input.code }));
    await db.prepare(
      `UPDATE cm_snippets SET description = ?, code = ?, input_schema_json = ?, connectors_json = ?, source_recipe_id = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(input.description, input.code, input.inputSchemaJson, input.connectorsJson, input.sourceRecipeId, input.now, input.existingId).run();
    return;
  }
  decide(Snippet, input.id, missing, new CreateSnippet({ ownerEmail: input.owner, name: input.name, body: input.code }));
  await db.prepare(
    `INSERT INTO cm_snippets (id, owner_email, name, description, code, input_schema_json, connectors_json, saved_at, source_recipe_id, codemode_execution_id, provenance, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'projected', ?, ?)`,
  ).bind(input.id, input.owner, input.name, input.description, input.code, input.inputSchemaJson, input.connectorsJson, input.savedAt, input.sourceRecipeId, input.codemodeExecutionId, input.now, input.now).run();
}

export async function receiveEmailRecord(db: RecordDb, email: { id: string; owner: string; from: string; to: string; subject: string; body: string }): Promise<void> {
  decide(Email, email.id, missing, new CreateEmail({ ownerEmail: email.owner, subject: email.subject, readAt: null }));
  await db.prepare("INSERT INTO emails (id, owner_email, from_addr, to_addr, subject, body, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))")
    .bind(email.id, email.owner, email.from, email.to, email.subject, email.body)
    .run();
}

export async function createAudioMessageRecord(db: RecordDb, row: {
  id: string; owner: string; sessionId: string; storageKey: string; text: string; voice: string; mime: string; bytes: number; createdAt: string; expiresAt: string;
}): Promise<void> {
  decide(AudioMessage, row.id, missing, new CreateAudioMessage({ ownerEmail: row.owner, storageKey: row.storageKey }));
  await db.prepare(`INSERT INTO audio_messages (id, owner_email, session_id, storage_key, text, voice, mime, bytes, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(row.id, row.owner, row.sessionId, row.storageKey, row.text, row.voice, row.mime, row.bytes, row.createdAt, row.expiresAt).run();
}

export async function deleteAudioMessageRecord(db: RecordDb, owner: string, id: string, storageKey: string): Promise<void> {
  decide(AudioMessage, id, present(owner, { storageKey }), new DeleteAudioMessage());
  await db.prepare("DELETE FROM audio_messages WHERE id = ? AND owner_email = ?").bind(id, owner).run();
}

export async function deleteSessionAudioRecords(db: RecordDb, owner: string, sessionId: string): Promise<string[]> {
  const result = await db.prepare("SELECT id, storage_key FROM audio_messages WHERE session_id = ? AND owner_email = ?")
    .bind(sessionId, owner).all<{ id: string; storage_key: string }>();
  const rows = result.results ?? [];
  for (const row of rows) decide(AudioMessage, row.id, present(owner, { storageKey: row.storage_key }), new DeleteAudioMessage());
  await db.prepare("DELETE FROM audio_messages WHERE session_id = ? AND owner_email = ?").bind(sessionId, owner).run();
  return rows.map((row) => row.storage_key);
}

export async function saveBrowserRecording(db: RecordDb, id: string, owner: string, sessionId: string): Promise<void> {
  const existing = await db.prepare("SELECT id FROM browser_recordings WHERE id = ?").bind(id).first<{ id: string }>();
  if (existing) decide(BrowserRecording, id, present(owner, { storageKey: id }), new UpdateBrowserRecording({ storageKey: id }));
  else decide(BrowserRecording, id, missing, new CreateBrowserRecording({ ownerEmail: owner, storageKey: id }));
  await db.prepare("INSERT OR REPLACE INTO browser_recordings(id, owner_email, session_id, created_at) VALUES (?, ?, ?, datetime('now'))")
    .bind(id, owner, sessionId).run();
}

export const WORKSPACE_SNAPSHOT_UPSERT = `INSERT INTO workspace_snapshots(owner_email, backup_id, backup_dir, size_bytes, snapshot_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))
       ON CONFLICT(owner_email) DO UPDATE SET backup_id=excluded.backup_id, backup_dir=excluded.backup_dir, size_bytes=excluded.size_bytes, snapshot_version=workspace_snapshots.snapshot_version + 1, updated_at=datetime('now')`;

export function decideWorkspaceSnapshot(owner: string, existingVersion: number | null, backupId: string, sizeBytes: number | null): void {
  if (existingVersion === null) {
    decide(WorkspaceSnapshot, owner, missing, new CreateWorkspaceSnapshot({ ownerEmail: owner, backupId, snapshotVersion: 1, sizeBytes }));
    return;
  }
  decide(
    WorkspaceSnapshot,
    owner,
    present(owner, { backupId: "", snapshotVersion: existingVersion, sizeBytes: null }),
    new UpdateWorkspaceSnapshot({ backupId, snapshotVersion: existingVersion + 1, sizeBytes }),
  );
}
