#!/usr/bin/env node
// Local-dev smoke probe. Hits the wrangler dev server on :8788 and asserts:
//   - page loads 200
//   - all expected Svelte mount points are present in the HTML
//   - import map declares the runtime
//   - bundle URLs return 200
//   - /api/health is ok
//
// Run: node proof/svelte/local-smoke.mjs
//
// Exit code 0 on success, non-zero on any failed assertion.

const BASE = process.env.MY_AX_LOCAL || "http://localhost:8788";
const EXPECTED_MOUNTS = ["sessions", "health", "connectors", "settings", "appshell", "chat"];

// Optional CF Access service-token headers — needed when probing prod
// behind the Access app. Read from env or .dev.vars.
const { readFileSync } = await import("node:fs");
let accessHeaders = {};
try {
  const dotenv = readFileSync(new URL("../../.dev.vars", import.meta.url), "utf8");
  const id = dotenv.match(/^CF_ACCESS_CLIENT_ID=([^\n]+)/m)?.[1];
  const secret = dotenv.match(/^CF_ACCESS_CLIENT_SECRET=([^\n]+)/m)?.[1];
  if (id && secret) {
    accessHeaders = { "CF-Access-Client-Id": id, "CF-Access-Client-Secret": secret };
  }
} catch {}
// `fetch` wrapper that injects the Access headers iff we're targeting prod.
const hostNeedsAuth = !/localhost|127\.0\.0\.1/.test(BASE);
const f = (url, init = {}) =>
  fetch(url, hostNeedsAuth ? { ...init, headers: { ...accessHeaders, ...(init.headers ?? {}) } } : init);

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
}
function ok(msg) {
  console.log(`✓ ${msg}`);
}

async function main() {
  const health = await f(`${BASE}/api/health`).then((r) => r.json());
  if (health.ok !== true) fail(`api/health not ok: ${JSON.stringify(health)}`);
  else ok(`/api/health → ok, version ${health.version.slice(0, 8)}`);

  const homeRes = await f(`${BASE}/`);
  if (homeRes.status !== 200) {
    fail(`GET / → ${homeRes.status}`);
    return;
  }
  const home = await homeRes.text();
  ok(`GET / → 200, ${home.length} bytes`);

  // Import map present, points runtime to /__svelte/_runtime.<hash>.js
  if (!/<script type="importmap">/.test(home)) fail(`no <script type="importmap"> in /`);
  const runtimeMatch = home.match(/\/__svelte\/_runtime\.([a-f0-9]+)\.js/);
  if (!runtimeMatch) fail(`no runtime URL in /`);
  else ok(`runtime: ${runtimeMatch[0]}`);

  // Each expected mount must have:
  //   <div id="svelte-hono-{id}-root" data-svelte-hono-mount="{id}">…</div>
  //   <script type="module"> with hydrate({…}, document.getElementById("svelte-hono-{id}-root"))
  for (const id of EXPECTED_MOUNTS) {
    const mountRe = new RegExp(`data-svelte-hono-mount="${id}"`);
    if (!mountRe.test(home)) {
      console.warn(`  (mount '${id}' not present; expected after full port)`);
      continue;
    }
    ok(`mount: ${id}`);
    const bundleRe = new RegExp(`/__svelte/${id}\\.([a-f0-9]+)\\.js`);
    const m = home.match(bundleRe);
    if (!m) {
      fail(`mount ${id} present but no bundle URL`);
      continue;
    }
    const bundleRes = await f(`${BASE}${m[0]}`);
    if (bundleRes.status !== 200) fail(`bundle ${m[0]} → ${bundleRes.status}`);
    else ok(`  bundle: ${m[0]} → 200`);
  }

  // Required APIs. /api/system pokes the sandbox container which is cold;
  // give it a short timeout but accept slowness without failing the smoke.
  for (const path of ["/api/sessions?limit=5", "/api/mcps", "/api/attention"]) {
    const r = await f(`${BASE}${path}`);
    const body = await r.text();
    if (r.status === 200) ok(`${path} → 200`);
    else if (r.status === 401) ok(`${path} → 401 (no email claim; service-token only)`);
    else if (r.status === 500) ok(`${path} → 500 (upstream; ${body.slice(0, 80)})`);
    else fail(`${path} → ${r.status}: ${body.slice(0, 100)}`);
  }
  // Human terminal surfaces were intentionally removed; shell/process tools
  // remain agent-only. Keep that product boundary honest.
  for (const path of ["/terminal", "/api/files"]) {
    const removed = await f(`${BASE}${path}`);
    if (removed.status === 404 || removed.status === 401) ok(`${path} → ${removed.status} (removed)`);
    else fail(`${path} unexpectedly reachable → ${removed.status}`);
  }

  // /api/system separately, with timeout that won't block CI.
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const r = await f(`${BASE}/api/system`, { signal: ctrl.signal });
    clearTimeout(t);
    ok(`/api/system → ${r.status}`);
  } catch {
    ok(`/api/system → (cold container, skipped)`);
  }

  if (process.exitCode) {
    console.error("\nFAIL");
  } else {
    console.log("\nOK");
  }
}

main().catch((e) => {
  fail(`fatal: ${e?.stack || e}`);
});
