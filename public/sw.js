// my · ax service worker — runtime static-asset cache without caching private data.
//
// Cloudflare Access gates the entire hostname, including assets. Personalized
// pages/API/WS always stay on network. Successful same-origin static responses
// may be cached at runtime; Access redirects and errors are never cached.

const CACHE = "my-ax-static-v11";
const MANIFEST_PATH = "/static/brand/manifest.webmanifest";

function offlineManifest() {
  return new Response(JSON.stringify({
    id: "/",
    name: "My Agent Experience",
    short_name: "my · ax",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
  }), { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-store" } });
}

// Cloudflare Access gates the entire hostname, including static assets. Do
// NOT precache during install: an expired Access session redirects asset
// fetches to the Access login origin, and Cache.addAll() turns that CORS
// redirect into an install failure. Runtime caching warms assets only after a
// successful same-origin response.
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
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function cacheableStatic(url) {
  return url.pathname === "/favicon.ico" || url.pathname.startsWith("/static/");
}

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

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache authenticated pages. If Access expires, let the navigation
  // reach the ordinary login flow rather than serving a misleading blank or
  // stale shell from the service worker.
  if (request.mode === "navigate") return;

  // NETWORK-FIRST for anonymous deploy assets (was cache-first). A cache-first
  // SW is the classic iOS-PWA staleness trap: once `/static/styles.css?v=<old>`
  // is cached, an installed PWA that restores a frozen shell keeps requesting
  // the SAME old `?v=` URL and the SW serves the stale file forever — closing
  // and reopening the app does not help because iOS restores app state instead
  // of doing a real navigation that would fetch the new build's HTML (and thus
  // the new `?v=`). Network-first means every asset fetch tries the live
  // deploy first and only falls back to cache when genuinely offline, so a
  // deploy is picked up on the next load. Assets are already fingerprinted with
  // `?v=<buildId>` and served with immutable caching upstream, so the extra
  // conditional request is cheap (304) and never double-downloads.
  if (cacheableStatic(url)) {
    event.respondWith(
      fetch(request).then((response) => {
        // Only cache successful same-origin responses. Access/login redirects
        // and errors must never become durable browser state.
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(async () => {
        // Offline (or an Access redirect that rejects under CORS): serve the
        // last good cached copy, or a minimal offline manifest, without an
        // unhandled rejection.
        return (await caches.match(request)) ?? (url.pathname === MANIFEST_PATH ? offlineManifest() : Response.error());
      }),
    );
  }
});
