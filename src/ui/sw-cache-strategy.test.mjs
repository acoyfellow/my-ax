#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const sw = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
const indexTsx = readFileSync(new URL("../../src/index.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../../src/views/Layout.tsx", import.meta.url), "utf8");

test("the service worker never intercepts or caches application requests", () => {
  assert.doesNotMatch(sw, /addEventListener\("fetch"/, "the service worker must not intercept requests");
  assert.doesNotMatch(sw, /caches\.(open|match)\(/, "the service worker must not populate or serve Cache Storage");
});

test("SW activates a new deploy immediately (skip-waiting message + bumped cache)", () => {
  assert.match(sw, /addEventListener\("message",[\s\S]*?my-ax:skip-waiting[\s\S]*?skipWaiting\(\)/,
    "SW must skipWaiting on the my-ax:skip-waiting message");
  const cache = sw.match(/const CACHE = "(my-ax-static-v\d+)"/);
  assert.ok(cache, "cache name is versioned");
  assert.ok(Number(cache[1].match(/v(\d+)/)[1]) >= 12, "cache name bumped to purge the old cache-first cache");
  assert.match(sw, /key\.startsWith\("my-ax-"\)[\s\S]{0,100}caches\.delete\(key\)/, "activation purges every historical My AX cache");
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

test("the HTML app shell is served no-cache so relaunch re-fetches current bundle hashes", () => {
  const i = indexTsx.indexOf("const renderApp = ");
  assert.ok(i >= 0, "renderApp present");
  const block = indexTsx.slice(i, i + 500);
  assert.match(block, /Cache-Control["']\s*,\s*["'][^"']*no-cache/, "the app-shell HTML must be no-cache; a heuristically-cached shell pins stale ?v=/bundle hashes and freezes an installed PWA on an old build");
});

test("pwa-reset unregisters workers and deletes caches without loading an application bundle", () => {
  const i = indexTsx.indexOf('app.get("/pwa-reset"');
  assert.ok(i >= 0, "/pwa-reset route present");
  const block = indexTsx.slice(i, i + 4000);
  assert.match(block, /getRegistrations\(\)/, "reset enumerates service-worker registrations");
  assert.match(block, /registration\.unregister\(\)/, "reset unregisters every service worker");
  assert.match(block, /caches\.keys\(\)/, "reset enumerates Cache Storage");
  assert.match(block, /caches\.delete\(key\)/, "reset deletes every cache");
  assert.doesNotMatch(block, /<SvelteEmbed|<Layout/, "reset must not depend on the application bundle");
});
