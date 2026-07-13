// views/Layout.tsx — top-level page shell.
//
// Theme-aware SSR. The server reads the
// `myax-theme` cookie and stamps `<html class="dark|light">` (or no class
// for "system") before sending the response. For system mode an inline
// synchronous script in <head> upgrades the bare <html> to .dark / .light
// based on matchMedia, so first paint is always already-themed (no FOUC).
//
// Earlier iteration history:
//
//   5.0 (2026-05-13) Compiled Tailwind v4 stylesheet + self-hosted woff2
//                    fonts. Dropped CDN scripts.
//   4.0 (2026-05-09) JSX server-rendering, Tailwind Play CDN, font CDNs.
//
// Design tokens (--color-bg, --color-bg-alt, --color-line, --color-fg,
// --color-fg-mut, --color-brand, --color-good, --color-warn, --color-bad)
// live in src/styles/app.css. They're redefined per-theme in :root vs
// .light blocks, so the same Tailwind utility (`bg-bg`, `text-fg`, …)
// renders correctly in both themes without per-utility `dark:` prefixes.

import type { FC, PropsWithChildren } from "hono/jsx";
import { svelteHeadTags } from "../../proof/svelte/embed";

const SvelteHonoHead: FC<{ buildId?: string }> = ({ buildId }) => {
  const tags = svelteHeadTags(buildId);
  if (!tags) return null;
  return <span dangerouslySetInnerHTML={{ __html: tags }} />;
};

/** What the user prefers. The "system" value defers to OS preference and
 *  is the default for new sessions. */
// Canonical ThemePref lives in src/routes/theme.ts alongside the cookie
// helpers and the POST /api/preferences/theme endpoint. Re-export here
// so JSX views can keep importing it from ./Layout without churn.
export type { ThemePref } from "../routes/theme";
import type { ThemePref } from "../routes/theme";

interface LayoutProps {
  /** <title> tag content. */
  title: string;
  /** Identity email for the header pill (null while bootstrapping). */
  identityEmail?: string | null;
  /** Optional class on <body>. Pages that own the viewport pass
   *  `h-dvh overflow-hidden`. */
  bodyClass?: string;
  /** Build sha for cache-busting static assets. Wired up by index.tsx from
   *  CF_VERSION_METADATA.id; falls back to a fixed string in dev. */
  buildId?: string;
  /** Version Metadata timestamp prevents backward reloads during rolling deploys. */
  buildTimestamp?: string;
  /** Server-resolved theme preference. Drives the class on <html> and the
   *  anti-flash script. Defaults to "system" if the cookie is missing. */
  theme?: ThemePref;
  /** Public origin of this deployment (for manifest + social metadata). */
  appOrigin?: string;
}

/** Constant copy used in both <title> defaults and OG meta. Kept in one
 *  place so a rename doesn't drift across surfaces. */
const SITE_NAME = "my · ax";
const SITE_DESCRIPTION =
  "A personal AI agent operating environment you self-host on Cloudflare.";

// Cloudflare Access gates every hostname path, including static assets. A
// browser manifest request is a CORS fetch, so when an Access session expires
// the edge redirects it to the login origin and Chrome logs a noisy CORS
// failure before either the Worker or service worker can reliably intervene.
// Keep this tiny install manifest inline; icon requests remain ordinary assets.
function pwaManifest(origin: string) { return {
  id: `${origin}/`,
  name: "My Agent Experience",
  short_name: "my · ax",
  description: SITE_DESCRIPTION,
  start_url: `${origin}/`,
  scope: `${origin}/`,
  display: "standalone",
  display_override: ["window-controls-overlay", "standalone", "minimal-ui"],
  orientation: "any",
  background_color: "#0b1118",
  theme_color: "#0b1118",
  categories: ["productivity", "utilities"],
  launch_handler: { client_mode: "focus-existing" },
  protocol_handlers: [
    { protocol: "web+myax", url: `${origin}/?launch=%s` },
  ],
  shortcuts: [
    { name: "New chat", short_name: "New", url: `${origin}/?action=new`, icons: [{ src: `${origin}/static/brand/icon-192.png`, sizes: "192x192", type: "image/png" }] },
    { name: "Active jobs", short_name: "Jobs", url: `${origin}/?action=settings#jobs`, icons: [{ src: `${origin}/static/brand/icon-192.png`, sizes: "192x192", type: "image/png" }] },
    { name: "Notifications", short_name: "Attention", url: `${origin}/?action=attention`, icons: [{ src: `${origin}/static/brand/icon-192.png`, sizes: "192x192", type: "image/png" }] },
  ],
  icons: [
    { src: `${origin}/static/brand/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
    { src: `${origin}/static/brand/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
    { src: `${origin}/static/brand/icon-maskable-192.png`, sizes: "192x192", type: "image/png", purpose: "maskable" },
    { src: `${origin}/static/brand/icon-maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
}; }
function inlineManifest(origin: string) {
  return `data:application/manifest+json,${encodeURIComponent(JSON.stringify(pwaManifest(origin)))}`;
}

/** Inline anti-flash script. Synchronous + tiny so it runs before paint.
 *
 *  Strategy:
 *  - If <html> already has `.light` or `.dark` (SSR stamped it from the
 *    cookie), this is a no-op.
 *  - If <html> is bare (cookie was missing or said "system"), read
 *    matchMedia('(prefers-color-scheme: dark)') and add the matching class.
 *  - Either way, set the `theme-color` meta to the bg of the chosen
 *    theme so iOS Safari + Android Chrome tint the status bar correctly.
 *
 *  This is the ONE place we accept synchronous JS in <head>: ~280 bytes
 *  minified, blocks paint for ~0.5ms, eliminates theme flicker on system
 *  mode reloads. Worth the trade. */
const ANTI_FLASH_SCRIPT = `(function(){try{var h=document.documentElement;if(!h.classList.contains('dark')&&!h.classList.contains('light')){var d=window.matchMedia('(prefers-color-scheme: dark)').matches;h.classList.add(d?'dark':'light');}var m=document.querySelector('meta[name=theme-color]');if(m){m.content=h.classList.contains('light')?'#ffffff':'#0b1118';}}catch(e){}})();`;

/** Register the root-scope service worker and wire installed-app launch
 *  affordances. All of this is progressive enhancement: unsupported browsers
 *  quietly keep the normal web flow. */
function pwaBootScript(buildId?: string, buildTimestamp?: string): string {
  const deployed = JSON.stringify({ id: buildId || "", timestamp: buildTimestamp || "" });
  return '(function(){var current=' + deployed + ',lastCheck=0,checking=false;function q(fn){if(document.readyState===\'loading\')document.addEventListener(\'DOMContentLoaded\',fn,{once:true});else fn();}function apply(u){try{var url=new URL(u||location.href,location.href);var action=url.searchParams.get(\'action\');if(action===\'new\'){sessionStorage.setItem(\'my-ax-start-fresh-once\',\'1\');url.searchParams.delete(\'action\');location.href=url.pathname+(url.search||\'\')+(url.hash||\'\');return;}if(action===\'settings\')q(function(){var f=function(){window.dispatchEvent(new Event(\'my-ax:settings-open\'));};f();setTimeout(f,250);});if(action===\'attention\')q(function(){var f=function(){window.dispatchEvent(new Event(\'my-ax:attention-open\'));};f();setTimeout(f,250);});}catch(e){}}function newer(id,stamp){if(!id||id===current.id)return false;var a=Date.parse(current.timestamp||\'\'),b=Date.parse(stamp||\'\');return !(Number.isFinite(a)&&Number.isFinite(b)&&b<=a);}function check(force){var now=Date.now();if(!current.id||checking||!navigator.onLine||document.visibilityState!==\'visible\'||(!force&&now-lastCheck<60000))return;checking=true;lastCheck=now;fetch(\'/api/version\',{cache:\'no-store\',credentials:\'same-origin\',headers:{\'If-None-Match\':\'"\'+current.id+\'"\'}}).then(function(r){if(r.status===304||!r.ok)return null;var id=r.headers.get(\'X-My-Ax-Version\')||\'\',stamp=r.headers.get(\'X-My-Ax-Version-Timestamp\')||\'\';return newer(id,stamp)?{id:id,timestamp:stamp}:null;}).then(function(next){if(!next)return;current=next;var event=new CustomEvent(\'my-ax:deploy-update\',{cancelable:true,detail:next});if(window.dispatchEvent(event))location.reload();}).catch(function(){}).finally(function(){checking=false;});}if(\'serviceWorker\'in navigator){var swReloaded=false;navigator.serviceWorker.addEventListener(\'controllerchange\',function(){if(swReloaded)return;swReloaded=true;location.reload();});addEventListener(\'load\',function(){navigator.serviceWorker.register(\'/sw.js\',{scope:\'/\'}).then(function(r){r.update();if(r.waiting)r.waiting.postMessage({type:\'my-ax:skip-waiting\'});r.addEventListener(\'updatefound\',function(){var nw=r.installing;if(nw)nw.addEventListener(\'statechange\',function(){if(nw.state===\'installed\'&&navigator.serviceWorker.controller)nw.postMessage({type:\'my-ax:skip-waiting\'});});});}).catch(function(){});});document.addEventListener(\'visibilitychange\',function(){if(document.visibilityState===\'visible\')navigator.serviceWorker.getRegistration().then(function(r){if(r)r.update();}).catch(function(){});});}if(current.id){setTimeout(function(){check(false);},60000);setInterval(function(){check(false);},900000);document.addEventListener(\'visibilitychange\',function(){if(document.visibilityState===\'visible\')check(true);});addEventListener(\'online\',function(){check(true);});}if(\'launchQueue\'in window&&\'LaunchParams\'in window){launchQueue.setConsumer(function(params){var target=params&&params.targetURL;if(target){var url=new URL(target);if(url.pathname!==location.pathname||url.search!==location.search||url.hash!==location.hash){location.href=url.pathname+url.search+url.hash;return;}apply(url.href);}});}apply(location.href);})();';
}

/** The frame is a position:fixed inset:0 flex column (see .app-viewport in
 * app.css) with height:100dvh, so it follows the mobile URL bar and cannot be
 * scroll-offset — no JS scroll resets are needed. This script only annotates
 * the keyboard-open state (via visualViewport) so the composer can drop its
 * bottom safe-area buffer while the on-screen keyboard is up. */
const VIEWPORT_SYNC_SCRIPT = `(function(){var root=document.documentElement,vv=window.visualViewport;if(!vv)return;var baseline=vv.height;function editable(){var e=document.activeElement;return e&&(e.tagName==='INPUT'||e.tagName==='TEXTAREA'||e.isContentEditable);}function sync(){var h=vv.height;if(!editable()&&h>baseline)baseline=h;root.classList.toggle('keyboard-open',editable()&&baseline-h>100);}vv.addEventListener('resize',sync,{passive:true});addEventListener('focusin',function(){setTimeout(sync,50)},{passive:true});addEventListener('focusout',function(){root.classList.remove('keyboard-open');},{passive:true});addEventListener('orientationchange',function(){baseline=vv.height;sync()},{passive:true});})();`;


/** Resolve which class (if any) goes on <html> for SSR.
 *  - "light" / "dark" → that class is stamped → no flash even if JS is off
 *  - "system"          → no class → the anti-flash script picks before paint
 */
function htmlClassFor(theme: ThemePref): string {
  if (theme === "light") return "light";
  if (theme === "dark") return "dark";
  return "";
}

/** The <meta name="theme-color"> value for SSR. The anti-flash script
 *  will rewrite it after class resolution, but we ship a sensible initial
 *  value so the OS status-bar tint is right on first paint. */
function initialThemeColor(theme: ThemePref): string {
  if (theme === "light") return "#ffffff";
  // For dark + system we default to dark; the anti-flash JS will flip the
  // meta when system resolves to light. The status-bar tint flicker (if
  // any) is invisible compared to the page itself.
  return "#0b1118";
}

export const Layout: FC<PropsWithChildren<LayoutProps>> = (props) => {
  // Asset version query string — bumps every deploy so browsers don't serve
  // stale CSS/JS/fonts when we ship. Falls back to "dev" locally so file
  // hashes don't churn on every save.
  const v = props.buildId || "dev";
  const theme: ThemePref = props.theme || "system";
  const origin = (props.appOrigin || "").replace(/\/$/, "");
  const htmlClass = htmlClassFor(theme);

  return (
    <html lang="en" class={htmlClass} data-theme-pref={theme}>
      <head>
        <meta charset="UTF-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content"
        />
        {/* color-scheme + theme-color cooperate with the user agent: the
            former tells the browser to render scrollbars + form controls
            in the matching scheme; the latter tints the mobile status
            bar / desktop title bar. The anti-flash script rewrites both
            if it resolves system → light. */}
        <meta name="color-scheme" content={theme === "light" ? "light" : theme === "dark" ? "dark" : "light dark"} />
        <meta name="theme-color" content={initialThemeColor(theme)} />
        <meta name="description" content={SITE_DESCRIPTION} />
        <meta name="application-name" content="my · ax" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="my · ax" />

        <title>{props.title}</title>

        {/* Anti-flash script — runs before paint. See ANTI_FLASH_SCRIPT
            constant above for the rationale. */}
        <script dangerouslySetInnerHTML={{ __html: ANTI_FLASH_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: VIEWPORT_SYNC_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: pwaBootScript(props.buildId, props.buildTimestamp) }} />

        {/* ── Favicons + PWA manifest ────────────────────────────────────
            Generated by scripts/build-brand.mjs from a single master SVG.
            We ship three icon flavors so every platform gets a sharp one:
              - favicon.ico        : multi-res ICO for legacy Windows tabs
              - icon-mark.svg      : scalable, used by modern browsers
              - icon-mask.svg      : monochrome for Safari pinned tab
              - apple-touch-icon   : 180×180 PNG for iOS home-screen
              - manifest.webmanifest references 192 + 512 PNGs
            All assets are behind Access just like the rest of the app —
            an unauthenticated browser will get the Access challenge before
            it can fetch any of these. That's fine; they only render once
            the user is in. */}
        <link rel="icon" href={`/favicon.ico?v=${v}`} sizes="any" />
        <link
          rel="icon"
          type="image/svg+xml"
          href={`/static/brand/icon-mark.svg?v=${v}`}
        />
        <link
          rel="apple-touch-icon"
          href={`/static/brand/apple-touch-icon.png?v=${v}`}
        />
        <link
          rel="mask-icon"
          href={`/static/brand/icon-mask.svg?v=${v}`}
          color="#f6821f"
        />
        <link
          rel="manifest"
          href={inlineManifest(origin)}
        />

        {/* ── Open Graph + Twitter Card ──────────────────────────────────
            Absolute URLs follow the configured deployment origin. */}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={SITE_NAME} />
        <meta property="og:title" content={props.title} />
        <meta property="og:description" content={SITE_DESCRIPTION} />
        <meta
          property="og:image"
          content={`${origin}/static/brand/og.png?v=${v}`}
        />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:url" content={`${origin}/`} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={props.title} />
        <meta name="twitter:description" content={SITE_DESCRIPTION} />
        <meta
          name="twitter:image"
          content={`${origin}/static/brand/og.png?v=${v}`}
        />

        {/* ── Compiled stylesheet ───────────────────────────────────────
            Single ~10 KB gzipped file. Includes Tailwind utilities,
            @font-face declarations, base styles, and the dark+light token
            blocks. Built by:
              npm run build:css
            Source: src/styles/app.css */}
        <link rel="stylesheet" href={`/static/styles.css?v=${v}`} />

        {/* svelte-hono shared runtime: importmap + modulepreload. Empty
            string when no Svelte components are mounted on the worker. */}
        <SvelteHonoHead buildId={v} />
      </head>
      <body class={`app-viewport bg-bg text-fg antialiased ${props.bodyClass ?? ""}`}>
        {/* Skip link — first focusable element. Visible only when focused.
            href= is a no-op; the inline onclick locates whichever <main>
            this page rendered and focuses it. Works for chat (#log) and
            any future full-viewport shell without duplicating the convention. */}
        <a
          href="#"
          onclick="event.preventDefault();const m=document.querySelector('main');if(m){m.tabIndex=-1;m.focus();m.scrollIntoView({block:'start'})}"
          class="
            sr-only focus:not-sr-only
            focus:fixed focus:top-2 focus:left-2 focus:z-[100]
            focus:rounded-md focus:bg-brand focus:text-black
            focus:px-3 focus:py-2 focus:text-sm focus:font-semibold
          "
        >
          Skip to content
        </a>
        {props.children}
      </body>
    </html>
  );
};
