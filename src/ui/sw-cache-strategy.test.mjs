#!/usr/bin/env node
// Guards the service-worker freshness contract that fixes the iOS-PWA stale
// asset trap (owner: "closed/opened the PWA 10x, still no fix").
//
// The bug: a CACHE-FIRST sw served /static/*?v=<old> forever to an installed
// PWA, because iOS restores a frozen shell (same old ?v=) instead of doing a
// real navigation that would fetch the new build. These assertions pin the fix:
//   1. static assets are served NETWORK-FIRST (cache is offline fallback only)
//   2. the SW honors a skip-waiting message so a deploy takes over immediately
//   3. the runtime cache name was bumped (old caches purged on activate)
//   4. sw.js is served no-cache by the worker so the browser re-fetches it
// Static-source assertions (no bundler/browser needed) so this runs in CI.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const sw = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
const indexTsx = readFileSync(new URL("../../src/index.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../../src/views/Layout.tsx", import.meta.url), "utf8");

test("static asset handler is network-first, not cache-first", () => {
  const i = sw.indexOf("if (cacheableStatic(url)) {");
  assert.ok(i >= 0, "cacheableStatic branch present");
  const block = sw.slice(i, i + 900);
  // Network-first: the FIRST thing inside respondWith is fetch(request), and
  // caches.match is only reached in the .catch (offline) path.
  assert.match(block, /event\.respondWith\(\s*fetch\(request\)/, "must try the network first");
  const fetchPos = block.indexOf("fetch(request)");
  const catchPos = block.indexOf(".catch(");
  const matchPos = block.indexOf("caches.match(request)");
  assert.ok(fetchPos >= 0 && catchPos >= 0 && matchPos > catchPos,
    "caches.match must only be reached in the offline .catch fallback (cache-first regression)");
  // The old cache-first shape (caches.match(request).then(cached => cached ? ...))
  // must be gone.
  assert.doesNotMatch(block, /caches\.match\(request\)\.then\(\s*\(cached\)/,
    "the cache-first-then-network shape must not return");
});

test("SW activates a new deploy immediately (skip-waiting message + bumped cache)", () => {
  assert.match(sw, /addEventListener\("message",[\s\S]*?my-ax:skip-waiting[\s\S]*?skipWaiting\(\)/,
    "SW must skipWaiting on the my-ax:skip-waiting message");
  const cache = sw.match(/const CACHE = "(my-ax-static-v\d+)"/);
  assert.ok(cache, "cache name is versioned");
  assert.ok(Number(cache[1].match(/v(\d+)/)[1]) >= 11, "cache name bumped to purge the old cache-first cache");
});

test("the page reloads on controllerchange and nudges updates on focus", () => {
  assert.match(layout, /controllerchange/, "client reloads when a new SW takes control");
  assert.match(layout, /my-ax:skip-waiting/, "client tells a freshly-installed waiting SW to activate");
  assert.match(layout, /getRegistration\(\)[\s\S]{0,80}update\(\)/, "client re-checks for a SW update when the PWA becomes visible");
});

test("sw.js is served no-cache so the browser always re-fetches it", () => {
  const i = indexTsx.indexOf('app.get("/sw.js"');
  assert.ok(i >= 0, "/sw.js route present");
  const block = indexTsx.slice(i, i + 500);
  assert.match(block, /Cache-Control["']\s*,\s*["'][^"']*no-cache/, "sw.js must be no-cache");
});
