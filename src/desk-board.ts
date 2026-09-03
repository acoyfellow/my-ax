export const DESK_PREFERENCE_KEY = "desk.board";
export const DESK_MAX_CARDS = 30;
export const DESK_DEEP_LINK = "/?action=desk";
export const DESK_REPLY_MAX_CHARS = 3000;

export interface DeskCardReply {
  label: string;
  prompt: string;
  placeholder: string;
}

export interface DeskCard {
  id: string;
  title: string;
  body: string;
  href: string | null;
  actionHref: string | null;
  actionLabel: string | null;
  status: string | null;
  agent: string | null;
  originSessionId: string | null;
  reply: DeskCardReply | null;
  updatedAt: string;
}

export interface DeskBoard {
  cards: DeskCard[];
  updatedAt: string;
}

export interface PreparedDeskCardReply {
  cardId: string;
  cardUpdatedAt: string;
  originSessionId: string;
  clientMsgId: string;
  content: string;
}

export type DeskStatusTone = "attention" | "bad" | "ok" | "neutral";

const ID_RE = /^[a-zA-Z0-9._:-]{1,80}$/;

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
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = cleanId(row.id);
  const title = cleanText(row.title, 160);
  if (!id || !title) return null;
  const reply = parseDeskCardReply(row.reply);
  if (Object.hasOwn(row, "reply") && row.reply != null && !reply) return null;
  const originSessionId = cleanId(row.originSessionId);
  if (reply && !originSessionId) return null;
  const hasActionHref = Object.hasOwn(row, "actionHref");
  const actionHref = cleanActionHref(hasActionHref ? row.actionHref : row.decisionHref);
  return {
    id,
    title,
    body: cleanText(row.body, 800) ?? "",
    href: cleanSourceHref(row.href),
    actionHref,
    actionLabel: actionHref ? cleanText(row.actionLabel, 80) ?? (hasActionHref ? "Open action" : "Decide") : null,
    status: cleanText(row.status, 80),
    agent: cleanText(row.agent, 120),
    originSessionId,
    reply,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : new Date().toISOString(),
  };
}

export function upsertDeskCard(board: DeskBoard, incoming: unknown, now = new Date().toISOString()): DeskBoard {
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) throw new Error("invalid desk card");
  const raw = incoming as Record<string, unknown>;
  const id = cleanId(raw.id);
  const existing = id ? board.cards.find((item) => item.id === id) : undefined;
  const card = parseDeskCard({
    ...existing,
    ...raw,
    href: Object.hasOwn(raw, "href") ? raw.href : existing?.href,
    actionHref: Object.hasOwn(raw, "actionHref")
      ? raw.actionHref
      : Object.hasOwn(raw, "decisionHref")
        ? raw.decisionHref
        : existing?.actionHref,
    actionLabel: Object.hasOwn(raw, "actionLabel")
      ? raw.actionLabel
      : Object.hasOwn(raw, "decisionHref") && !Object.hasOwn(raw, "actionHref")
        ? "Decide"
        : existing?.actionLabel,
    body: Object.hasOwn(raw, "body") ? raw.body : existing?.body,
    title: Object.hasOwn(raw, "title") ? raw.title : existing?.title,
    status: Object.hasOwn(raw, "status") ? raw.status : existing?.status,
    agent: Object.hasOwn(raw, "agent") ? raw.agent : existing?.agent,
    originSessionId: Object.hasOwn(raw, "originSessionId") ? raw.originSessionId : existing?.originSessionId,
    reply: Object.hasOwn(raw, "reply") ? raw.reply : existing?.reply,
    updatedAt: now,
  });
  if (!card) throw new Error("invalid desk card");
  const next = [card, ...board.cards.filter((item) => item.id !== card.id)].slice(0, DESK_MAX_CARDS);
  return { cards: next, updatedAt: now };
}

export function prepareDeskCardReply(board: DeskBoard, cardId: string, response: unknown): PreparedDeskCardReply {
  const card = board.cards.find((item) => item.id === cardId);
  if (!card?.reply || !card.originSessionId) throw new Error("desk card cannot receive a reply");
  if (typeof response !== "string") throw new Error("reply must be text");
  const answer = response.trim();
  if (!answer) throw new Error("reply must not be empty");
  if (answer.length > DESK_REPLY_MAX_CHARS) throw new Error(`reply must be at most ${DESK_REPLY_MAX_CHARS} characters`);
  const content = [
    "[desk reply]",
    `Card: ${card.title}`,
    ...(card.body ? [`Context: ${card.body}`] : []),
    `Prompt: ${card.reply.prompt}`,
    `Answer: ${answer}`,
  ].join("\n");
  return {
    cardId: card.id,
    cardUpdatedAt: card.updatedAt,
    originSessionId: card.originSessionId,
    clientMsgId: `desk-reply:${card.id}:${card.updatedAt}`,
    content,
  };
}

export function markDeskCardReplied(board: DeskBoard, reply: PreparedDeskCardReply, now = new Date().toISOString()): DeskBoard {
  const card = board.cards.find((item) => item.id === reply.cardId);
  if (!card?.reply || card.updatedAt !== reply.cardUpdatedAt || card.originSessionId !== reply.originSessionId) {
    throw new Error("desk card changed before the reply was recorded");
  }
  return upsertDeskCard(board, { id: card.id, status: "answered", reply: null }, now);
}

export function deskStatusTone(status: string | null): DeskStatusTone {
  const normalized = status?.toLowerCase() ?? "";
  if (/(failed|blocked|rejected|error)/.test(normalized)) return "bad";
  if (/(approved|answered|complete|completed|done)/.test(normalized)) return "ok";
  if (/(pending|needs input|waiting|review)/.test(normalized)) return "attention";
  return "neutral";
}

function parseDeskCardReply(value: unknown): DeskCardReply | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const label = cleanText(row.label, 80);
  const prompt = cleanText(row.prompt, 400);
  if (!label || !prompt) return null;
  return { label, prompt, placeholder: cleanText(row.placeholder, 160) ?? "Write a reply" };
}

function cleanId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return ID_RE.test(id) ? id : null;
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : null;
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

function cleanActionHref(value: unknown): string | null {
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
