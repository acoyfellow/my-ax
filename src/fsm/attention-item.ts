import { markAttentionItemsSeen } from "../domain/Attention/Attention.store";

export type AttentionState = "unseen" | "seen";

export type AttentionEvent = "seen";

const ATTENTION_TRANSITIONS: Readonly<Record<AttentionEvent, { from: readonly AttentionState[]; to: AttentionState }>> = {
  seen: { from: ["unseen"], to: "seen" },
};

export function nextAttentionState(current: AttentionState, event: AttentionEvent): AttentionState | null {
  const transition = ATTENTION_TRANSITIONS[event];
  return transition.from.includes(current) ? transition.to : null;
}

export function attentionState(row: { seen_at: string | null }): AttentionState {
  return row.seen_at === null ? "unseen" : "seen";
}

export interface AttentionDb {
  prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown> } };
}

export async function markAttentionSeen(db: AttentionDb, ownerEmail: string, scope: { ids?: readonly string[]; filterSql?: string; filterBinds?: readonly unknown[] } = {}): Promise<number> {
  return markAttentionItemsSeen(db, ownerEmail, scope);
}
