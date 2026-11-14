import { decide } from "../decide";
import { Attention, type AttentionStage } from "./Attention.aggregate";
import { DismissAttention } from "./DismissAttention.command";
import { MarkAttentionSeen } from "./MarkAttentionSeen.command";
import { RaiseAttention } from "./RaiseAttention.command";

type Statement = { run(): Promise<unknown>; all?<T>(): Promise<{ results?: T[] }> };
export type AttentionStoreDb = { prepare(sql: string): { bind(...values: unknown[]): Statement } };

type Scope = { ids?: readonly string[]; filterSql?: string; filterBinds?: readonly unknown[] };

const present = (ownerEmail: string, stage: AttentionStage) => ({ _tag: "Present" as const, ownerEmail, stage });
const changedRows = (result: unknown) => {
  const changes = (result as { meta?: { changes?: unknown } } | null)?.meta?.changes;
  return typeof changes === "number" ? changes : 0;
};

const MARK_SEEN = "UPDATE attention_items SET seen_at = datetime('now') WHERE owner_email = ? AND seen_at IS NULL";
const UNSEEN_IDS = "SELECT id FROM attention_items WHERE owner_email = ? AND seen_at IS NULL";

async function unseenIds(db: AttentionStoreDb, ownerEmail: string, where: string, binds: readonly unknown[]): Promise<string[] | null> {
  const statement = db.prepare(`${UNSEEN_IDS}${where}`).bind(ownerEmail, ...binds);
  if (!statement.all) return null;
  return ((await statement.all<{ id: string }>()).results ?? []).map((row) => row.id);
}

function decideSeen(ownerEmail: string, ids: readonly string[]): void {
  for (const id of ids) decide(Attention, id, present(ownerEmail, "Unseen"), new MarkAttentionSeen());
}

export async function markAttentionItemsSeen(db: AttentionStoreDb, ownerEmail: string, scope: Scope = {}): Promise<number> {
  if (scope.ids) {
    if (!scope.ids.length) return 0;
    decideSeen(ownerEmail, scope.ids);
    const placeholders = scope.ids.map(() => "?").join(",");
    return changedRows(await db.prepare(`${MARK_SEEN} AND id IN (${placeholders})`).bind(ownerEmail, ...scope.ids).run());
  }
  const where = scope.filterSql ?? "";
  const binds = scope.filterBinds ?? [];
  decideSeen(ownerEmail, (await unseenIds(db, ownerEmail, where, binds)) ?? []);
  return changedRows(await db.prepare(`${MARK_SEEN}${where}`).bind(ownerEmail, ...binds).run());
}

export type RaisedAttention = {
  id: string; owner: string; sessionId: string | null; kind: string; title: string; body: string; href: string; dedupeKey: string | null; notificationTag: string | null;
};

export async function raiseAttentionItem(db: AttentionStoreDb, item: RaisedAttention): Promise<void> {
  decide(Attention, item.id, { _tag: "Missing" }, new RaiseAttention({ ownerEmail: item.owner, stage: "Unseen" }));
  await db.prepare(`INSERT INTO attention_items(id, owner_email, session_id, kind, title, body, href, created_at, dedupe_key, notification_tag)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)`).bind(
    item.id, item.owner, item.sessionId, item.kind, item.title, item.body, item.href, item.dedupeKey, item.notificationTag,
  ).run();
  await db.prepare(`DELETE FROM attention_items WHERE owner_email = ? AND id NOT IN (
      SELECT id FROM attention_items WHERE owner_email = ? ORDER BY created_at DESC LIMIT 200
    )`).bind(item.owner, item.owner).run();
}

export async function dismissAttentionItem(db: AttentionStoreDb, ownerEmail: string, id: string): Promise<void> {
  decide(Attention, id, present(ownerEmail, "Unseen"), new DismissAttention());
  await db.prepare("DELETE FROM attention_items WHERE id = ? AND owner_email = ?").bind(id, ownerEmail).run();
}

export async function dismissAllAttention(db: AttentionStoreDb, ownerEmail: string): Promise<number> {
  const statement = db.prepare("SELECT id FROM attention_items WHERE owner_email = ?").bind(ownerEmail);
  const ids = statement.all ? ((await statement.all<{ id: string }>()).results ?? []).map((row) => row.id) : [];
  for (const id of ids) decide(Attention, id, present(ownerEmail, "Unseen"), new DismissAttention());
  return changedRows(await db.prepare("DELETE FROM attention_items WHERE owner_email = ?").bind(ownerEmail).run());
}
