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
  decision?: { id: string; options: string[] };
  progressTag?: string;
  progressTerminal?: boolean;
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

const MAX_HREF_LENGTH = 2048;

// Web Push record budget (mirrors push.ts:87 — a 4080-byte record incl. the
// 1-byte padding delimiter, so JSON payload must be <= 4079 bytes).
export const MAX_PUSH_PAYLOAD_BYTES = 4_079;
export const PROGRESS_PUSH_MIN_INTERVAL_SECONDS = 60;

export interface PushAction {
  action: string;
  title: string;
}

export interface PushPayload extends Record<string, unknown> {
  title: string;
  body: string;
  href: string;
  destinationHref: string;
  kind: NotificationKind;
  attentionId?: string;
  unread: number;
  actions: PushAction[];
  decision?: { id: string; options: string[] };
  progressTag?: string;
  progressTerminal?: boolean;
  dismissTags?: string[];
  sessionId?: string;
}

export function attentionDeepLink(attentionId: string): string {
  return `/?action=attention&attentionId=${encodeURIComponent(attentionId)}`;
}

/** Include the optional, caller-supplied sessionId ONLY when the full serialized
 *  payload stays within the push record budget; otherwise omit it so an oversized
 *  id cannot make every device's delivery throw. Never truncates the id. Pure. */
export function boundedPushPayload<T extends Record<string, unknown>>(
  base: T,
  sessionId: string | undefined,
): T | (T & { sessionId: string }) {
  if (typeof sessionId !== "string") return base;
  const withSession = { ...base, sessionId };
  const bytes = new TextEncoder().encode(JSON.stringify(withSession)).length;
  return bytes <= MAX_PUSH_PAYLOAD_BYTES ? withSession : base;
}

function payloadFits(payload: unknown): boolean {
  return new TextEncoder().encode(JSON.stringify(payload)).length <= MAX_PUSH_PAYLOAD_BYTES;
}

function defaultPushActions(destinationHref: string): PushAction[] {
  return destinationHref === "/"
    ? [{ action: "open", title: "Open notification" }, { action: "attention", title: "All notifications" }]
    : [{ action: "open", title: "Open notification" }, { action: "destination", title: "Open source" }];
}

function decisionPushData(notification: OwnerNotification): { id: string; options: string[] } | undefined {
  const decision = notification.decision;
  if (!decision || typeof decision.id !== "string" || decision.id.length === 0 || !Array.isArray(decision.options)) return undefined;
  const options = decision.options.slice(0, 2);
  if (!options.length || !options.every((option) => typeof option === "string" && cleanText(option, 1).length > 0)) return undefined;
  return { id: decision.id, options };
}

function normalizeDismissalTags(tags: string[] | undefined): string[] {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.filter((tag) => typeof tag === "string" && tag.length > 0 && tag.length <= 256))].slice(0, 50);
}

export function buildOwnerPushPayload(
  notification: OwnerNotification,
  input: { destinationHref: string; attentionId?: string; unread: number; progressTag?: string; progressTerminal: boolean; dismissalTags?: string[] },
): { payload: PushPayload; dismissalTags: string[] } {
  const attentionHref = input.attentionId ? attentionDeepLink(input.attentionId) : input.destinationHref;
  let payload: PushPayload = {
    title: cleanText(notification.title, 80) || "my · ax",
    body: cleanText(notification.body, 300),
    href: input.attentionId ? attentionHref : input.destinationHref,
    destinationHref: input.destinationHref,
    kind: notification.kind,
    attentionId: input.attentionId,
    unread: input.unread,
    actions: defaultPushActions(input.destinationHref),
    progressTag: input.progressTag,
    progressTerminal: input.progressTag ? input.progressTerminal : undefined,
  };
  const decision = decisionPushData(notification);
  if (decision) {
    const candidate: PushPayload = {
      ...payload,
      actions: decision.options.map((option, index) => ({ action: `decision:${index}`, title: cleanText(option, 48) })),
      decision,
    };
    if (payloadFits(candidate)) payload = candidate;
  }
  const dismissalTags = normalizeDismissalTags(input.dismissalTags);
  if (dismissalTags.length) {
    const candidate: PushPayload = { ...payload, dismissTags: dismissalTags };
    if (payloadFits(candidate)) payload = candidate;
  }
  return {
    payload: boundedPushPayload(payload, notification.sessionId) as PushPayload,
    dismissalTags: payload.dismissTags ?? [],
  };
}

function progressTag(value: string | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 256 ? value : undefined;
}

async function reserveProgressPush(env: Env, ownerEmail: string, tag: string): Promise<boolean> {
  const result = await env.DB.prepare(`INSERT INTO push_progress_updates(owner_email, tag, last_sent_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(owner_email, tag) DO UPDATE SET last_sent_at = excluded.last_sent_at
    WHERE push_progress_updates.last_sent_at <= datetime('now', ?)`)
    .bind(ownerEmail, tag, `-${PROGRESS_PUSH_MIN_INTERVAL_SECONDS} seconds`).run();
  return Number(result.meta?.changes ?? 0) === 1;
}

async function clearProgressPush(env: Env, ownerEmail: string, tag: string): Promise<void> {
  await env.DB.prepare("DELETE FROM push_progress_updates WHERE owner_email = ? AND tag = ?").bind(ownerEmail, tag).run();
}

async function pendingDismissalTags(env: Env, ownerEmail: string): Promise<string[]> {
  const result = await env.DB.prepare("SELECT tag FROM push_dismissals WHERE owner_email = ? AND created_at >= datetime('now', '-1 day') ORDER BY created_at ASC LIMIT 50")
    .bind(ownerEmail).all<{ tag: string }>();
  return normalizeDismissalTags((result.results ?? []).map((row) => row.tag));
}

async function clearDeliveredDismissalTags(env: Env, ownerEmail: string, tags: string[]): Promise<void> {
  if (!tags.length) return;
  const placeholders = tags.map(() => "?").join(",");
  await env.DB.prepare(`DELETE FROM push_dismissals WHERE owner_email = ? AND tag IN (${placeholders})`).bind(ownerEmail, ...tags).run();
}

function safeHref(notification: OwnerNotification, baseUrl: string): string {
  const fallbackCandidate = notification.sessionId
    ? `/?session=${encodeURIComponent(notification.sessionId)}`
    : "/";
  // The fallback is itself unbounded (sessionId is caller-supplied), so bound it too.
  const fallback = fallbackCandidate.length <= MAX_HREF_LENGTH ? fallbackCandidate : "/";
  if (!notification.href) return fallback;
  try {
    if (/^https:\/\/(gitlab\.cfdata\.org|github\.com|www\.github\.com)\//i.test(notification.href) && notification.href.length <= MAX_HREF_LENGTH) {
      return notification.href;
    }
    const base = new URL(baseUrl);
    const url = new URL(notification.href, base.origin);
    const href = `${url.pathname}${url.search}${url.hash}`;
    if (url.origin !== base.origin || href.startsWith("//") || href.length > MAX_HREF_LENGTH) return fallback;
    return href;
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

export function defaultDedupeKey(notification: OwnerNotification): string {
  const kind = notification.kind;
  const title = notification.title.trim();
  const body = notification.body.trim();
  return `content:${kind}:${title}:${body}`;
}

/** A suppressed (deduped) delivery: no push was sent because the identical
 *  event was already delivered within the window. */
export function dedupedReceipt(): NotificationReceipt {
  return { delivered: 0, expired: 0, failed: 0, devices: 0 };
}

/** Deliver a same-owner agent notification to every subscribed installed app. */
export async function notifyOwner(env: Env, ownerEmail: string, notification: OwnerNotification): Promise<NotificationReceipt> {
  const email = ownerEmail.toLowerCase();
  const taggedProgress = progressTag(notification.progressTag);
  const terminalProgress = taggedProgress !== undefined && notification.progressTerminal === true;
  const intermediateProgress = taggedProgress !== undefined && !terminalProgress;
  if (intermediateProgress && !await reserveProgressPush(env, email, taggedProgress)) return dedupedReceipt();
  const dedupeKey = notification.dedupeKey?.trim() || (terminalProgress
    ? `progress-terminal:${taggedProgress}`
    : defaultDedupeKey(notification));
  if (!intermediateProgress && dedupeKey) {
    const cutoff = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
    const recent = await env.DB.prepare(
      "SELECT id FROM attention_items WHERE owner_email = ? AND dedupe_key = ? AND created_at >= ? LIMIT 1",
    ).bind(email, dedupeKey, cutoff).first<{ id: string }>().catch(() => null);
    if (recent) return dedupedReceipt();
  }
  if (terminalProgress) await clearProgressPush(env, email, taggedProgress);
  const result = await env.DB.prepare(
    "SELECT endpoint, subscription_json FROM push_subscriptions WHERE owner_email = ? ORDER BY updated_at DESC",
  ).bind(email).all<{ endpoint: string; subscription_json: string }>();
  const rows = result.results ?? [];
  const receipt: NotificationReceipt = { delivered: 0, expired: 0, failed: 0, devices: rows.length };
  const destinationHref = safeHref(notification, env.BRIDGE_BASE_URL);
  const attentionId = intermediateProgress ? undefined : crypto.randomUUID();
  const notificationTag = taggedProgress ?? attentionId;
  if (attentionId) {
    await env.DB.prepare(`INSERT INTO attention_items(id, owner_email, session_id, kind, title, body, href, created_at, dedupe_key, notification_tag)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)`).bind(
      attentionId, email, notification.sessionId ?? null, notification.kind,
      cleanText(notification.title, 50) || "my · ax", cleanText(notification.body, 200), destinationHref, dedupeKey, notificationTag,
    ).run();
    await env.DB.prepare(`DELETE FROM attention_items WHERE owner_email = ? AND id NOT IN (
      SELECT id FROM attention_items WHERE owner_email = ? ORDER BY created_at DESC LIMIT 200
    )`).bind(email, email).run();
  }
  const unreadRow = await env.DB.prepare("SELECT COUNT(*) AS count FROM attention_items WHERE owner_email = ? AND seen_at IS NULL").bind(email).first<{ count: number }>();
  const { payload, dismissalTags } = buildOwnerPushPayload(notification, {
    destinationHref,
    attentionId,
    unread: Number(unreadRow?.count ?? 0),
    progressTag: taggedProgress,
    progressTerminal: terminalProgress,
    dismissalTags: await pendingDismissalTags(env, email),
  });
  // Deliver to every device concurrently. Each send has a timeout and retries
  // only on transient network errors; provider HTTP rejections are classified,
  // not retried. Replaces a sequential try/catch loop with no timeout/retry.
  const deliverOne = (row: { endpoint: string; subscription_json: string }) =>
    Effect.gen(function* () {
      const host = endpointHost(row.endpoint);
      // Parse the stored subscription ONCE, outside the retried effect. A
      // malformed subscription_json is a deterministic, local failure — retrying
      // it cannot help and just triples the work. Only the async send below is
      // wrapped in the network-retry schedule.
      const subscription = yield* Effect.try({
        try: () => JSON.parse(row.subscription_json) as PushSubscription,
        catch: (cause) => new PushNetworkError({ cause }),
      });
      const response = yield* Effect.tryPromise({
        try: () => sendPush(env, subscription, payload, 300),
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
  if (dismissalTags.length && receipt.delivered > 0 && receipt.failed === 0) await clearDeliveredDismissalTags(env, email, dismissalTags);
  return receipt;
}
