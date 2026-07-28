export interface AttentionItemState {
  id: string;
  seen_at: string | null;
}

export function reconcileSeen<T extends AttentionItemState>(
  items: T[],
  serverUnread: number,
  seenIds: readonly string[],
  seenAt: string,
): { items: T[]; unread: number } {
  const ids = new Set(seenIds);
  return {
    items: items.map((item) => ids.has(item.id) && !item.seen_at ? { ...item, seen_at: seenAt } : item),
    unread: Math.max(0, serverUnread),
  };
}
