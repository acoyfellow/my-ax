export const DESK_PREFERENCE_KEY = "desk.board";
export const DESK_MAX_CARDS = 30;
export const DESK_DEEP_LINK = "/?action=desk";

export type DeskCardStatus = "pending" | "approved" | "rejected";

export interface DeskCard {
  id: string;
  title: string;
  body: string;
  href: string | null;
  decisionHref: string | null;
  status: DeskCardStatus;
  updatedAt: string;
}

export interface DeskBoard {
  cards: DeskCard[];
  updatedAt: string;
}

const ID_RE = /^[a-zA-Z0-9._:-]{1,80}$/;
const STATUSES = new Set<DeskCardStatus>(["pending", "approved", "rejected"]);

export function emptyDeskBoard(now = new Date().toISOString()): DeskBoard {
  return { cards: [], updatedAt: now };
}

export function parseDeskBoard(raw: unknown): DeskBoard {
  if (!raw || typeof raw !== "object") return emptyDeskBoard();
  const cardsIn = Array.isArray((raw as { cards?: unknown }).cards) ? (raw as { cards: unknown[] }).cards : [];
  const cards: DeskCard[] = [];
  for (const item of cardsIn) {
    const card = parseDeskCard(item);
    if (card) cards.push(card);
    if (cards.length >= DESK_MAX_CARDS) break;
  }
  const updatedAt = typeof (raw as { updatedAt?: unknown }).updatedAt === "string"
    ? (raw as { updatedAt: string }).updatedAt
    : new Date().toISOString();
  return { cards, updatedAt };
}

export function parseDeskCard(raw: unknown): DeskCard | null {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof (raw as { id?: unknown }).id === "string" ? (raw as { id: string }).id.trim() : "";
  const title = typeof (raw as { title?: unknown }).title === "string" ? (raw as { title: string }).title.trim() : "";
  if (!ID_RE.test(id) || !title) return null;
  const statusRaw = typeof (raw as { status?: unknown }).status === "string" ? (raw as { status: string }).status : "pending";
  const status = STATUSES.has(statusRaw as DeskCardStatus) ? statusRaw as DeskCardStatus : "pending";
  const href = cleanSourceHref((raw as { href?: unknown }).href);
  const decisionHref = cleanDecisionHref((raw as { decisionHref?: unknown }).decisionHref);
  return {
    id,
    title: title.slice(0, 160),
    body: typeof (raw as { body?: unknown }).body === "string" ? (raw as { body: string }).body.trim().slice(0, 800) : "",
    href,
    decisionHref,
    status,
    updatedAt: typeof (raw as { updatedAt?: unknown }).updatedAt === "string" ? (raw as { updatedAt: string }).updatedAt : new Date().toISOString(),
  };
}

export function upsertDeskCard(board: DeskBoard, incoming: unknown, now = new Date().toISOString()): DeskBoard {
  if (!incoming || typeof incoming !== "object") throw new Error("invalid desk card");
  const raw = incoming as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const existing = board.cards.find((item) => item.id === id);
  const card = parseDeskCard({
    ...existing,
    ...raw,
    href: Object.hasOwn(raw, "href") ? raw.href : existing?.href,
    decisionHref: Object.hasOwn(raw, "decisionHref") ? raw.decisionHref : existing?.decisionHref,
    body: Object.hasOwn(raw, "body") ? raw.body : existing?.body,
    title: Object.hasOwn(raw, "title") ? raw.title : existing?.title,
    status: Object.hasOwn(raw, "status") ? raw.status : existing?.status,
    updatedAt: now,
  });
  if (!card) throw new Error("invalid desk card");
  const next = [card, ...board.cards.filter((item) => item.id !== card.id)].slice(0, DESK_MAX_CARDS);
  return { cards: next, updatedAt: now };
}

export function removeDeskCard(board: DeskBoard, incomingId: unknown, now = new Date().toISOString()): DeskBoard {
  const id = typeof incomingId === "string" ? incomingId.trim() : "";
  if (!ID_RE.test(id)) throw new Error("invalid desk card id");
  return { cards: board.cards.filter((card) => card.id !== id), updatedAt: now };
}

function sameOriginPath(href: string): string | null {
  if (href.startsWith("/") && href[1] !== "/" && href[1] !== "\\") return href;
  return null;
}

function cleanRemoteHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const href = value.trim();
  if (!href || href.length > 2048) return null;
  try {
    const url = new URL(href);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    const gitlabHost = ["gitlab", ["cf", "data"].join(""), "org"].join(".");
    if (url.hostname !== gitlabHost && url.hostname !== "github.com" && url.hostname !== "www.github.com") return null;
    return href;
  } catch {
    return null;
  }
}

function cleanSourceHref(value: unknown): string | null {
  return cleanRemoteHref(value);
}

function cleanDecisionHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const href = value.trim();
  if (!href || href.length > 2048) return null;
  const path = sameOriginPath(href);
  if (path) {
    if (/^\/\?action=/i.test(path)) return null;
    return path;
  }
  return cleanRemoteHref(href);
}
