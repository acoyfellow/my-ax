import { Effect, Schedule, Duration, Data } from "effect";
import type { Env } from "./types";
import { sendPush, type PushSubscription } from "./push";

// Network failures talking to a push provider are transient; a returned HTTP
// status (even an error one) is a real provider decision, not transient.
class PushNetworkError extends Data.TaggedError("PushNetworkError")<{ cause: unknown }> {}
const pushRetry = Schedule.intersect(
  Schedule.exponential(Duration.millis(150), 2).pipe(Schedule.jittered),
  Schedule.recurs(2),
).pipe(Schedule.whileInput((e: unknown) => e instanceof PushNetworkError));

type DeliveryOutcome =
  | { kind: "delivered" }
  | { kind: "expired"; failure?: NotificationFailureDetail }
  | { kind: "failed"; failure: NotificationFailureDetail };

export type NotificationKind = "session.update" | "session.dead" | "job.complete" | "job.needs_input" | "delegate.complete" | "delegate.needs_input" | "watch.fired" | "deploy.gate" | "recipe.approval";

/** Notification kinds that must drive the owner's "needs your attention" headline. */
export const ACTIONABLE_NOTIFICATION_KINDS: ReadonlyArray<NotificationKind> = [
  "session.dead",
  "job.needs_input",
  "delegate.needs_input",
  "deploy.gate",
  "recipe.approval",
];

const ACTIONABLE_KIND_SET: ReadonlySet<string> = new Set(ACTIONABLE_NOTIFICATION_KINDS);

/** Pure predicate: unknown/null/undefined kinds are conservatively informational. */
export function isActionableNotificationKind(kind: string | null | undefined): boolean {
  if (typeof kind !== "string" || kind.length === 0) return false;
  return ACTIONABLE_KIND_SET.has(kind);
}

export interface OwnerNotification {
  kind: NotificationKind;
  sessionId?: string;
  title: string;
  body: string;
  href?: string;
  dedupeKey?: string;
}

export interface NotificationFailureDetail {
  host: string;
  status?: number;
  reason: string;
}

export interface NotificationReceipt {
  delivered: number;
  expired: number;
  failed: number;
  devices: number;
  failures?: NotificationFailureDetail[];
}

function cleanText(value: string, max: number): string {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "unknown";
  }
}

function addFailure(receipt: NotificationReceipt, detail: NotificationFailureDetail) {
  receipt.failures ??= [];
  if (receipt.failures.length < 5) receipt.failures.push(detail);
}
async function rejectedReason(response: Response): Promise<string> {
  const detail = await response.text().catch(() => "");
  return cleanText(detail, 300) || response.statusText || "push provider rejected request";
}

function safeHref(notification: OwnerNotification, baseUrl: string): string {
  const fallback = notification.sessionId
    ? `/?session=${encodeURIComponent(notification.sessionId)}`
    : "/";
  if (!notification.href) return fallback;
  try {
    const base = new URL(baseUrl);
    const url = new URL(notification.href, base.origin);
    if (url.origin !== base.origin) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

/** How long an identical dedupeKey suppresses a resend. Recurring jobs (min
 *  cadence 60s), dead-session rechecks, and delegate receipts re-fire the SAME
 *  logical event repeatedly; without suppression each hits the push provider
 *  and eventually earns a 429. One hour comfortably covers recheck loops while
 *  still letting a genuinely new occurrence through. */
export const DEDUPE_WINDOW_MS = 60 * 60 * 1000;

/** A suppressed (deduped) delivery: no push was sent because the identical
 *  event was already delivered within the window. */
export function dedupedReceipt(): NotificationReceipt {
  return { delivered: 0, expired: 0, failed: 0, devices: 0 };
}

/** Deliver a same-owner agent notification to every subscribed installed app. */
export async function notifyOwner(env: Env, ownerEmail: string, notification: OwnerNotification): Promise<NotificationReceipt> {
  const email = ownerEmail.toLowerCase();
  // De-duplicate: if the caller supplied a dedupeKey and we already recorded
  // that exact event for this owner within the window, do NOT send another
  // push. This is the fix for provider 429s: the key was accepted but ignored,
  // so repeated rechecks/ticks flooded the same subscription.
  const dedupeKey = notification.dedupeKey?.trim() || null;
  if (dedupeKey) {
    const cutoff = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
    const recent = await env.DB.prepare(
      "SELECT id FROM attention_items WHERE owner_email = ? AND dedupe_key = ? AND created_at >= ? LIMIT 1",
    ).bind(email, dedupeKey, cutoff).first<{ id: string }>().catch(() => null);
    if (recent) return dedupedReceipt();
  }
  const result = await env.DB.prepare(
    "SELECT endpoint, subscription_json FROM push_subscriptions WHERE owner_email = ? ORDER BY updated_at DESC",
  ).bind(email).all<{ endpoint: string; subscription_json: string }>();
  const rows = result.results ?? [];
  const receipt: NotificationReceipt = { delivered: 0, expired: 0, failed: 0, devices: rows.length };
  const href = safeHref(notification, env.BRIDGE_BASE_URL);
  const attentionId = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO attention_items(id, owner_email, session_id, kind, title, body, href, created_at, dedupe_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`).bind(
      attentionId, email, notification.sessionId ?? null, notification.kind,
      cleanText(notification.title, 50) || "my · ax", cleanText(notification.body, 200), href, dedupeKey,
    ).run();
  // Keep the tiny recent-attention surface bounded. Push is a wake-up hint,
  // not an unbounded activity-log product.
  await env.DB.prepare(`DELETE FROM attention_items WHERE owner_email = ? AND id NOT IN (
    SELECT id FROM attention_items WHERE owner_email = ? ORDER BY created_at DESC LIMIT 200
  )`).bind(email, email).run();
  const unreadRow = await env.DB.prepare("SELECT COUNT(*) AS count FROM attention_items WHERE owner_email = ? AND seen_at IS NULL").bind(email).first<{ count: number }>();
  const actions = notification.kind === "deploy.gate"
    ? [{ action: "open", title: "Review gate" }, { action: "attention", title: "Inbox" }]
    : notification.kind === "job.complete" || notification.kind === "job.needs_input"
      ? [{ action: "open", title: "Open job" }, { action: "attention", title: "Inbox" }]
      : notification.kind === "delegate.complete" || notification.kind === "delegate.needs_input"
        ? [{ action: "open", title: "Open delegation" }, { action: "attention", title: "Inbox" }]
        : [{ action: "open", title: "Open" }, { action: "attention", title: "Inbox" }];
  const payload = {
    title: cleanText(notification.title, 80) || "my · ax",
    body: cleanText(notification.body, 300),
    href,
    kind: notification.kind,
    sessionId: notification.sessionId,
    attentionId,
    unread: Number(unreadRow?.count ?? 1),
    actions,
  };
  // Deliver to every device concurrently. Each send has a timeout and retries
  // only on transient network errors; provider HTTP rejections are classified,
  // not retried. Replaces a sequential try/catch loop with no timeout/retry.
  const deliverOne = (row: { endpoint: string; subscription_json: string }) =>
    Effect.gen(function* () {
      const host = endpointHost(row.endpoint);
      const response = yield* Effect.tryPromise({
        try: () => sendPush(env, JSON.parse(row.subscription_json) as PushSubscription, payload, 300),
        catch: (cause) => new PushNetworkError({ cause }),
      }).pipe(Effect.timeout(Duration.seconds(25)), Effect.retry(pushRetry));
      if (response.ok) return { kind: "delivered" } as DeliveryOutcome;
      const reason = yield* Effect.promise(() => rejectedReason(response));
      const relinkRequired = /VapidPkHashMismatch|VAPID credentials.*do not correspond/i.test(reason);
      if (response.status === 404 || response.status === 410 || relinkRequired) {
        // VAPID mismatch / gone endpoint is permanent: drop it so routine
        // notifications stop retrying a known-bad device. Settings exposes Relink.
        yield* Effect.promise(() => env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND owner_email = ?").bind(row.endpoint, email).run());
        return { kind: "expired", failure: relinkRequired ? { host, status: response.status, reason: `Relink required: ${reason}` } : undefined } as DeliveryOutcome;
      }
      console.warn("push_notify_rejected", { ownerEmail: email, kind: notification.kind, host, status: response.status, reason });
      return { kind: "failed", failure: { host, status: response.status, reason } } as DeliveryOutcome;
    }).pipe(
      Effect.catchAll((error) => {
        const nested = error instanceof PushNetworkError ? error.cause : undefined;
        const reason = (nested instanceof Error ? nested.message : nested ? String(nested) : "") || (error instanceof Error ? error.message : String(error)) || (typeof error === "object" && error && "_tag" in error ? String((error as { _tag: unknown })._tag) : "Push delivery timed out or failed");
        console.error("push_notify_failed", { ownerEmail: email, kind: notification.kind, host: endpointHost(row.endpoint), err: reason });
        return Effect.succeed({ kind: "failed", failure: { host: endpointHost(row.endpoint), reason } } as DeliveryOutcome);
      }),
    );

  const outcomes = await Effect.runPromise(Effect.forEach(rows, deliverOne, { concurrency: 6 }));
  for (const outcome of outcomes) {
    if (outcome.kind === "delivered") receipt.delivered += 1;
    else if (outcome.kind === "expired") { receipt.expired += 1; if (outcome.failure) addFailure(receipt, outcome.failure); }
    else { receipt.failed += 1; addFailure(receipt, outcome.failure); }
  }
  return receipt;
}
