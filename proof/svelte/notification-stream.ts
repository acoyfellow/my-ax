// Pure notification-stream model for the redesigned notifications panel (B).
//
// Unifies the two current sources — attention items (pings) and failed runs —
// into ONE typed, reverse-chronological, dismissable stream, replacing the
// "Now / Receipts" tab split and its two vocabularies. The Svelte panel renders
// this; all classification/merge/sort/dismiss logic lives here so it is pure
// and unit-tested. See designs/B-notifications-redesign.md.

import { isTransientRateLimit } from "../../src/upstream-rate-limit";

export type NotificationType = "failed" | "needs-you" | "retrying" | "done" | "ready" | "update";
export type NotificationTone = "bad" | "attention" | "retrying" | "ok" | "info";

export type AttentionItem = {
  id: string;
  kind?: string | null;
  title?: string | null;
  body?: string | null;
  href?: string | null;
  created_at?: string | null;
  seen_at?: string | null;
};

export type FailedRun = {
  id: string;
  status?: string | null;
  title?: string | null;
  task_summary?: string | null;
  updated_at?: string | null;
};

export type Notification = {
  id: string;            // stable per source row (attention id, or run:<id>)
  source: "attention" | "run";
  type: NotificationType;
  label: string;         // short type label shown as a pill
  tone: NotificationTone;
  title: string;
  body: string;
  href: string | null;       // primary action -> open the conversation
  widgetHref: string | null; // secondary action -> open the widget/artifact (e.g. /runs/<id>)
  ts: number;            // epoch ms for sorting
  unread: boolean;
};

const ACTIONABLE_KINDS = new Set([
  "session.dead", "job.needs_input", "delegate.needs_input", "deploy.gate", "recipe.approval",
]);
const DONE_KINDS = new Set(["job.complete", "delegate.complete"]);
// Accept an optional query/fragment: the UI opens receipts by URL.pathname, so
// /runs/r1?tab=log and /runs/r1#output are receipts too and must get a View
// action, not fall through to a plain "Update".
const RUN_RECEIPT_RE = /^\/runs\/[^/?#]+(?:[?#].*)?$/;

function toEpoch(iso: string | null | undefined): number {
  if (!iso) return 0;
  const s = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(iso) ? iso.replace(" ", "T") + "Z" : iso;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

const LABELS: Record<NotificationType, string> = {
  failed: "Failed",
  "needs-you": "Needs you",
  retrying: "Retrying",
  done: "Done",
  ready: "Ready",
  update: "Update",
};
const TONES: Record<NotificationType, NotificationTone> = {
  failed: "bad",
  "needs-you": "attention",
  retrying: "retrying",
  done: "ok",
  ready: "info",
  update: "info",
};

function typeForAttention(item: AttentionItem): NotificationType {
  const kind = (item.kind ?? "").trim();
  const text = `${item.title ?? ""} ${item.body ?? ""}`;
  // Explicit kind wins over body text: a job.needs_input whose body merely
  // mentions a rate limit must still read as "Needs you", not "Retrying".
  if (ACTIONABLE_KINDS.has(kind)) return "needs-you";
  if (DONE_KINDS.has(kind)) return "done";
  if (isTransientRateLimit(text)) return "retrying";
  // An artifact/widget deep-link ready to open.
  if (typeof item.href === "string" && RUN_RECEIPT_RE.test(item.href)) return "ready";
  return "update";
}

export function attentionToNotification(item: AttentionItem): Notification {
  const type = typeForAttention(item);
  const href = typeof item.href === "string" && item.href ? item.href : null;
  const widgetHref = href && RUN_RECEIPT_RE.test(href) ? href : null;
  return {
    id: item.id,
    source: "attention",
    type,
    label: LABELS[type],
    tone: TONES[type],
    title: (item.title ?? "").trim() || "Notification",
    body: (item.body ?? "").trim(),
    href,
    widgetHref,
    ts: toEpoch(item.created_at),
    unread: !item.seen_at,
  };
}

export function runToNotification(run: FailedRun): Notification {
  return {
    id: `run:${run.id}`,
    source: "run",
    type: "failed",
    label: LABELS.failed,
    tone: TONES.failed,
    title: (run.title ?? "").trim() || "Run failed",
    body: (run.task_summary ?? "").trim(),
    href: `/?run=${encodeURIComponent(run.id)}`,
    widgetHref: `/runs/${encodeURIComponent(run.id)}`,
    ts: toEpoch(run.updated_at),
    unread: true,
  };
}

/**
 * Merge attention items + failed runs into one sorted, de-duped, dismissable
 * stream. Newest first. `dismissed` holds notification ids the owner cleared;
 * they are filtered out. Pure.
 */
export function buildNotificationStream(
  attention: readonly AttentionItem[],
  failedRuns: readonly FailedRun[],
  dismissed: ReadonlySet<string> = new Set(),
): Notification[] {
  const all = [
    ...attention.map(attentionToNotification),
    ...failedRuns.map(runToNotification),
  ];
  const seen = new Set<string>();
  const out: Notification[] = [];
  for (const n of all) {
    if (dismissed.has(n.id)) continue;
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    out.push(n);
  }
  out.sort((a, b) => b.ts - a.ts);
  return out;
}

/** Unread count across the stream (drives the bell badge). */
export function unreadCount(stream: readonly Notification[]): number {
  return stream.reduce((n, item) => n + (item.unread ? 1 : 0), 0);
}
