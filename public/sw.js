const CACHE = "my-ax-static-v14";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "my-ax:skip-waiting") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key === CACHE || key.startsWith("my-ax-")).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function setAttentionBadge(count) {
  try {
    if (count > 0) await self.registration.setAppBadge?.(count);
    else await self.registration.clearAppBadge?.();
  } catch {}
  try {
    if (count > 0) await self.navigator?.setAppBadge?.(count);
    else await self.navigator?.clearAppBadge?.();
  } catch {}
}

function notificationActions(payload) {
  if (Array.isArray(payload.actions) && payload.actions.length) return payload.actions.slice(0, 2);
  return [{ action: "open", title: "Open notification" }, { action: "attention", title: "All notifications" }];
}

function normalizedDismissalTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.filter((tag) => typeof tag === "string" && tag.length > 0 && tag.length <= 256))];
}

async function closeDismissedNotifications(tags) {
  const tagSet = new Set(normalizedDismissalTags(tags));
  if (!tagSet.size) return false;
  const notifications = await self.registration.getNotifications();
  for (const notification of notifications) {
    if (tagSet.has(notification.tag)) notification.close();
  }
  return true;
}

async function updateBadgeFromNotifications(fallback) {
  try {
    const notifications = await self.registration.getNotifications();
    await setAttentionBadge(notifications.length);
  } catch {
    await setAttentionBadge(fallback);
  }
}

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data?.json() ?? {}; } catch { payload = {}; }
  event.waitUntil((async () => {
    const dismissed = await closeDismissedNotifications(payload.dismissTags);
    await self.registration.showNotification(payload.title || "my · ax", {
      body: payload.body || "You have a new my · ax notification.",
      data: {
        href: payload.href || "/?action=attention",
        attentionHref: "/?action=attention",
        destinationHref: payload.destinationHref || "/",
        decision: payload.decision,
        unread: Number(payload.unread || 0),
      },
      tag: payload.progressTag || payload.attentionId || undefined,
      renotify: payload.progressTag ? payload.progressTerminal === true : !!payload.attentionId,
      requireInteraction: payload.kind === "deploy.gate" || payload.kind === "job.needs_input",
      icon: "/static/brand/icon-192.png",
      badge: "/static/brand/icon-maskable-192.png",
      actions: notificationActions(payload),
    });
    if (dismissed) await updateBadgeFromNotifications(Number(payload.unread || 0));
    else await setAttentionBadge(Number(payload.unread || 1));
    for (const client of await clients.matchAll({ type: "window", includeUncontrolled: true })) client.postMessage({ type: "my-ax:attention" });
  })());
});

function isDecisionAction(action) {
  return typeof action === "string" && /^decision:\d+$/.test(action);
}

function notificationDecision(data, action) {
  const index = Number(action.slice("decision:".length));
  const id = data?.decision?.id;
  const options = data?.decision?.options;
  if (!Number.isInteger(index) || typeof id !== "string" || id.length === 0 || !Array.isArray(options) || typeof options[index] !== "string") return null;
  return { id, choice: options[index] };
}

function decisionPageHref(data) {
  const id = data?.decision?.id;
  if (typeof id === "string" && id.length > 0) return `/api/decisions/${encodeURIComponent(id)}`;
  return data?.href || "/?action=attention";
}

async function showDecisionFailure(data, status) {
  const alreadyAnswered = status === 409;
  const href = decisionPageHref(data);
  await self.registration.showNotification(alreadyAnswered ? "Decision already answered" : "Decision not recorded", {
    body: alreadyAnswered
      ? "This decision was already answered. Open it to review."
      : "Your choice was not recorded. Open the decision to sign in and try again.",
    data: { href, attentionHref: href, destinationHref: href },
    icon: "/static/brand/icon-192.png",
    badge: "/static/brand/icon-maskable-192.png",
    actions: [{ action: "open", title: "Open decision" }],
  });
}

async function submitDecision(notification, action) {
  const data = notification.data;
  const decision = notificationDecision(data, action);
  if (!decision) {
    await showDecisionFailure(data, 0);
    return;
  }
  try {
    const response = await fetch(`/api/decisions/${encodeURIComponent(decision.id)}/respond`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ choice: decision.choice }),
    });
    if (!response.ok) {
      await showDecisionFailure(data, response.status);
      return;
    }
    notification.close();
    await setAttentionBadge(Math.max(0, Number(data?.unread ?? 1) - 1));
  } catch {
    await showDecisionFailure(data, 0);
  }
}

async function navigateNotification(href) {
  const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
  const sameOrigin = windows.filter((client) => new URL(client.url).origin === self.location.origin);
  const existing = sameOrigin.find((client) => client.focused) || sameOrigin.find((client) => client.visibilityState === "visible") || sameOrigin[0];
  const target = new URL(href, self.location.origin);
  const absolute = target.href;
  const sameOriginTarget = target.origin === self.location.origin;
  if (existing) {
    if (target.pathname === "/" && !target.search && !target.hash && sameOriginTarget) return existing.focus();
    if (!sameOriginTarget) return clients.openWindow(absolute);
    const acked = await new Promise((resolve) => {
      const onAck = (ev) => {
        if (ev.data?.href !== absolute) return;
        if (ev.data?.type === "my-ax:navigate-ack") {
          self.removeEventListener("message", onAck);
          resolve(true);
        }
        if (ev.data?.type === "my-ax:navigate-nack") {
          self.removeEventListener("message", onAck);
          resolve(false);
        }
      };
      self.addEventListener("message", onAck);
      existing.postMessage({ type: "my-ax:navigate", href: absolute });
      setTimeout(() => { self.removeEventListener("message", onAck); resolve(false); }, 400);
    });
    if (!acked) await existing.navigate(absolute);
    return existing.focus();
  }
  return clients.openWindow(absolute);
}

self.addEventListener("notificationclick", (event) => {
  if (isDecisionAction(event.action)) {
    event.waitUntil(submitDecision(event.notification, event.action));
    return;
  }
  event.notification.close();
  const href = event.action === "attention"
    ? (event.notification.data?.attentionHref || "/?action=attention")
    : event.action === "destination"
      ? (event.notification.data?.destinationHref || "/")
      : (event.notification.data?.href || "/?action=attention");
  event.waitUntil(navigateNotification(href));
});
