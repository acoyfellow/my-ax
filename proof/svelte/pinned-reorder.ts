// Pure reorder helpers for the pinned-conversations group (#2 UI).
//
// The server owns the fractional rank; the client sends neighbor INTENT via
// POST /api/sessions/:id/rank { beforeId }. This module turns a move within
// the ordered pinned id list into (a) the beforeId to send and (b) the
// optimistic new order to render immediately. Kept pure so DnD and keyboard
// handlers stay thin and the mapping is unit-tested without a DOM.

/**
 * Given the current ordered pinned ids and a move of `movedId` to land at
 * `toIndex` (0-based position in the NEW order), return the optimistic new
 * order and the `beforeId` to send to the server.
 *
 * beforeId semantics (matches server computeMoveRank): the id the moved row
 * should sit immediately BEFORE, or null to go to the bottom.
 */
export function planReorder(
  order: readonly string[],
  movedId: string,
  toIndex: number,
): { order: string[]; beforeId: string | null } | null {
  const from = order.indexOf(movedId);
  if (from < 0) return null;
  const without = order.filter((id) => id !== movedId);
  const clamped = Math.max(0, Math.min(toIndex, without.length));
  const next = [...without.slice(0, clamped), movedId, ...without.slice(clamped)];
  // beforeId = the row that ends up immediately AFTER the moved row, or null
  // when it lands at the bottom.
  const beforeId = clamped < without.length ? without[clamped] : null;
  return { order: next, beforeId };
}

/**
 * Keyboard step: move `movedId` one slot in `direction` within the pinned
 * order. Returns null for a no-op (already at the edge). Delegates to
 * planReorder so DnD and keyboard share one path.
 */
export function planKeyboardStep(
  order: readonly string[],
  movedId: string,
  direction: "up" | "down",
): { order: string[]; beforeId: string | null; toIndex: number } | null {
  const from = order.indexOf(movedId);
  if (from < 0) return null;
  const toIndex = direction === "up" ? from - 1 : from + 1;
  if (toIndex < 0 || toIndex > order.length - 1) return null; // at the edge
  const plan = planReorder(order, movedId, toIndex);
  return plan ? { ...plan, toIndex } : null;
}

/** Split a session list into the pinned group (server order, pinned===1) and
 *  the unpinned tail (input order preserved). Pure. */
export function splitPinned<T extends { id: string; pinned?: number | null; pin_rank?: string | null }>(
  rows: readonly T[],
): { pinned: T[]; unpinned: T[] } {
  const pinned: T[] = [];
  const unpinned: T[] = [];
  for (const row of rows) {
    if (row.pinned === 1) pinned.push(row);
    else unpinned.push(row);
  }
  // Pinned rows sort by rank ASC (server already returns them ordered, but be
  // defensive so the client never renders a stale/mixed order).
  pinned.sort((a, b) => {
    const ra = a.pin_rank ?? "";
    const rb = b.pin_rank ?? "";
    return ra < rb ? -1 : ra > rb ? 1 : 0;
  });
  return { pinned, unpinned };
}

/** Human position announcement for aria-live during keyboard reorder. */
export function reorderAnnouncement(name: string, index: number, total: number): string {
  return `${name || "Conversation"}, pinned ${index + 1} of ${total}.`;
}
