const CACHE = "my-ax-static-v12";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

// The page (pwaBootScript) posts this when it detects a freshly-installed
// waiting SW, so a new deploy takes over an already-open PWA immediately
// instead of waiting for every tab to close (iOS never closes them). Pairs
// with the client's controllerchange -> reload.
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
  if (payload.kind === "deploy.gate") return [
    { action: "open", title: "Review gate" },
    { action: "attention", title: "Inbox" },
  ];
  if (payload.kind === "job.complete" || payload.kind === "job.needs_input") return [
    { action: "open", title: "Open job" },
    { action: "attention", title: "Inbox" },
  ];
  return [{ action: "open", title: "Open" }, { action: "attention", title: "Inbox" }];
}

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data?.json() ?? {}; } catch { payload = {}; }
  event.waitUntil((async () => {
    await self.registration.showNotification(payload.title || "my · ax", {
      body: payload.body || "You have a new my · ax notification.",
      data: { href: payload.href || "/", attentionHref: "/?action=attention" },
      tag: payload.attentionId || undefined,
      renotify: !!payload.attentionId,
      requireInteraction: payload.kind === "deploy.gate" || payload.kind === "job.needs_input",
      icon: "/static/brand/icon-192.png",
      badge: "/static/brand/icon-maskable-192.png",
      actions: notificationActions(payload),
    });
    await setAttentionBadge(Number(payload.unread || 1));
    for (const client of await clients.matchAll({ type: "window", includeUncontrolled: true })) client.postMessage({ type: "my-ax:attention" });
  })());
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = event.action === "attention" ? (event.notification.data?.attentionHref || "/?action=attention") : (event.notification.data?.href || "/");
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    const absolute = new URL(href, self.location.origin).href;
    if (existing) {
      // Navigating an already-open standalone PWA can restore its cached
      // conversation before the query-string target reaches Chat bootstrap.
      // Prefer the live in-page switch: post the target and wait briefly for
      // the app to ack. Only fall back to a hard .navigate() when the app is
      // not listening (e.g. mid-load), so we never double-navigate.
      const acked = await new Promise((resolve) => {
        const onAck = (ev) => {
          if (ev.data?.type === "my-ax:navigate-ack" && ev.data?.href === absolute) {
            self.removeEventListener("message", onAck);
            resolve(true);
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
  })());
});
