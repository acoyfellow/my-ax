import type { DeskBoard } from "./desk-board";

export type VoiceDeskAction = { kind: "approve" | "dismiss"; card: number };

export type VoiceDeskPlan =
  | { ok: true; cardId: string; title: string; change: { status: "approved" } | { remove: true } }
  | { ok: false; code: "NO_SUCH_CARD" | "NOT_PENDING" | "NOT_CONFIRMED"; message: string };

export function planVoiceDeskAction(board: DeskBoard, action: VoiceDeskAction, confirmed: boolean): VoiceDeskPlan {
  if (!confirmed) return { ok: false, code: "NOT_CONFIRMED", message: "say confirm to run this command" };
  const card = board.cards[action.card - 1];
  if (!Number.isInteger(action.card) || action.card < 1 || !card) return { ok: false, code: "NO_SUCH_CARD", message: `there is no desk card ${action.card}` };
  if (action.kind === "dismiss") return { ok: true, cardId: card.id, title: card.title, change: { remove: true } };
  if (card.status !== "pending") return { ok: false, code: "NOT_PENDING", message: `desk card ${action.card} is already ${card.status}` };
  return { ok: true, cardId: card.id, title: card.title, change: { status: "approved" } };
}

export function parseVoiceDeskRequest(raw: unknown): { action: VoiceDeskAction; confirmed: boolean; heard: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as { kind?: unknown; card?: unknown; confirmed?: unknown; heard?: unknown };
  if (body.kind !== "approve" && body.kind !== "dismiss") return null;
  if (typeof body.card !== "number" || !Number.isInteger(body.card) || body.card < 1 || body.card > 99) return null;
  const heard = typeof body.heard === "string" ? body.heard.slice(0, 500) : "";
  return { action: { kind: body.kind, card: body.card }, confirmed: body.confirmed === true, heard };
}
