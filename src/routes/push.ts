import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import type { ApiResponse } from "../types";
import { publicVapidKey, type PushSubscription } from "../push";
import { notifyOwner } from "../notify";
import { safePublicHttpUrl } from "../public-url";
import { removePushSubscription, savePushSubscription, type PushDb } from "../domain/PushSubscription/PushSubscription.store";

const pushDb = (db: unknown) => db as PushDb;

export function registerPushRoutes(app: Hono<AppEnv>) {
  app.get("/api/push/public-key", (c) => c.json<ApiResponse>({ ok: true, command: c.req.path, result: { publicKey: publicVapidKey(c.env) }, next_actions: [] }));
  app.post("/api/push/subscribe", async (c) => {
    const body = await c.req.json<PushSubscription | { subscription?: PushSubscription; oldEndpoint?: string }>();
    const wrapped = "subscription" in body;
    const sub = (wrapped ? body.subscription : body) as PushSubscription | undefined;
    const oldEndpoint = (wrapped ? body.oldEndpoint : undefined) as string | undefined;
    if (!sub?.endpoint || !sub.keys?.auth || !sub.keys?.p256dh) return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "BAD_SUBSCRIPTION", message: "Push subscription is incomplete" }, next_actions: [] }, 400);
    if (!safePublicHttpUrl(sub.endpoint, { httpsOnly: true }) || sub.endpoint.length > 2048 || sub.keys.auth.length > 256 || sub.keys.p256dh.length > 512) {
      return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "BAD_SUBSCRIPTION", message: "Push subscription contains an unsafe endpoint or oversized keys" }, next_actions: [] }, 400);
    }
    const email = c.get("identity").email.toLowerCase();
    const existing = await c.env.DB.prepare("SELECT owner_email FROM push_subscriptions WHERE endpoint = ?").bind(sub.endpoint).first<{ owner_email: string }>();
    if (existing && existing.owner_email !== email) return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "ENDPOINT_OWNED", message: "Push endpoint is already registered to another owner" }, next_actions: [] }, 409);
    const id = crypto.randomUUID();
    await savePushSubscription(pushDb(c.env.DB), { id, owner: email, endpoint: sub.endpoint, subscriptionJson: JSON.stringify(sub) });
    if (oldEndpoint && oldEndpoint !== sub.endpoint) {
      await removePushSubscription(pushDb(c.env.DB), email, oldEndpoint);
    }
    return c.json<ApiResponse>({ ok: true, command: c.req.path, result: { subscribed: true }, next_actions: [] }, 201);
  });
  app.post("/api/push/unsubscribe", async (c) => {
    const body = await c.req.json<{ endpoint?: string }>().catch(() => ({} as { endpoint?: string }));
    const endpoint = body.endpoint;
    if (!endpoint) return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "BAD_ENDPOINT", message: "Endpoint is required" }, next_actions: [] }, 400);
    const email = c.get("identity").email.toLowerCase();
    await removePushSubscription(pushDb(c.env.DB), email, endpoint);
    return c.json<ApiResponse>({ ok: true, command: c.req.path, result: { unsubscribed: true }, next_actions: [] });
  });
  app.post("/api/push/test", async (c) => {
    const email = c.get("identity").email.toLowerCase();
    // Test every registered installation. Selecting only the newest row made
    // an iPhone refresh hide a broken desktop PWA subscription after the split.
    const receipt = await notifyOwner(c.env, email, {
      kind: "session.update",
      title: "my · ax test",
      body: "Push notifications are working on this device.",
      href: "/",
    });
    if (receipt.devices === 0) return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "NO_SUBSCRIPTION", message: "Enable notifications first" }, next_actions: [] }, 404);
    return c.json<ApiResponse>({ ok: receipt.delivered > 0 && receipt.failed === 0, command: c.req.path, result: receipt, next_actions: receipt.expired > 0 ? [{ command: "Relink push", description: "Recreate expired browser subscriptions in Settings on those devices" }] : [] }, receipt.delivered > 0 && receipt.failed === 0 ? 200 : 502);
  });
  app.post("/api/push/agent-proof", async (c) => {
    const email = c.get("identity").email.toLowerCase();
    const receipt = await notifyOwner(c.env, email, {
      kind: "session.update",
      title: "my · ax agent",
      body: "Agent notification channel is working.",
      href: "/",
    });
    return c.json<ApiResponse>({ ok: receipt.delivered > 0, command: c.req.path, result: receipt, next_actions: [] }, receipt.delivered > 0 ? 200 : 502);
  });
  app.post("/api/push/notify", async (c) => {
    const email = c.get("identity").email.toLowerCase();
    type NotificationInput = {
      title?: unknown;
      body?: unknown;
      href?: unknown;
      kind?: unknown;
      dedupeKey?: unknown;
    };
    const body = await c.req.json<NotificationInput>().catch((): NotificationInput => ({}));
    const kinds = new Set(["session.update", "job.complete", "job.needs_input", "watch.fired", "deploy.gate"]);
    if (typeof body.title !== "string" || typeof body.body !== "string") {
      return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "BAD_NOTIFICATION", message: "title and body are required strings" }, next_actions: [] }, 400);
    }
    const kind = typeof body.kind === "string" && kinds.has(body.kind) ? body.kind as "session.update" | "job.complete" | "job.needs_input" | "watch.fired" | "deploy.gate" : "session.update";
    const receipt = await notifyOwner(c.env, email, {
      kind,
      title: body.title,
      body: body.body,
      href: typeof body.href === "string" ? body.href : "/",
      dedupeKey: typeof body.dedupeKey === "string" ? body.dedupeKey : undefined,
      stableName: "Owner notifications",
    });
    return c.json<ApiResponse>({ ok: receipt.delivered > 0 && receipt.failed === 0, command: c.req.path, result: receipt, next_actions: [] }, receipt.delivered > 0 && receipt.failed === 0 ? 200 : 502);
  });
}
