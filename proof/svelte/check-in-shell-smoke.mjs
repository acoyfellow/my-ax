#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");

function read(relativePath) {
  return readFileSync(join(repo, relativePath), "utf8");
}

function assertIncludes(haystack, needle, label) {
  if (!haystack.includes(needle)) {
    throw new Error(`${label} is missing ${JSON.stringify(needle)}`);
  }
}

function assertNotIncludes(haystack, needle, label) {
  if (haystack.includes(needle)) {
    throw new Error(`${label} unexpectedly contains ${JSON.stringify(needle)}`);
  }
}

const buildConfig = read("proof/svelte/build.mjs");
const chatPage = read("src/views/ChatPage.tsx");
const attention = read("proof/svelte/Attention.svelte");
const checkIn = read("proof/svelte/CheckIn.svelte");
const displayHrefHelper = read("proof/svelte/check-in-display-href.ts");
const displayHrefTest = read("proof/svelte/check-in-display-href.test.ts");
const generatedBundles = read("proof/svelte/bundles.generated.ts");
const ssr = read("proof/svelte/CheckIn.ssr.mjs");

assertIncludes(buildConfig, "checkin: here(\"CheckIn.svelte\")", "Svelte build config");
assertIncludes(generatedBundles, "checkin", "generated Svelte bundles");
assertIncludes(generatedBundles, "data-check-in-raw-href", "generated Check-in raw API href marker");
assertNotIncludes(chatPage, "hydrateAs=\"checkin\"", "Chat shell Check-in mount that steals composer space");
assertIncludes(attention, 'import CheckIn from "./CheckIn.svelte"', "Attention popup Check-in import");
assertIncludes(attention, "<CheckIn embedded />", "Attention popup embeds Check-in in modal mode");
assertIncludes(attention, "aria-label=\"Attention and Check-in\"", "Attention popup combined owner panel label");
assertIncludes(attention, ".attention-owner-panel::backdrop", "Attention owner modal uses native Settings-style backdrop");
assertIncludes(attention, "background: rgb(0 0 0 / 0.56);", "Attention owner modal backdrop dimming matches Settings");
assertIncludes(attention, "w-[min(760px,calc(100vw-1rem))]", "Attention owner modal width matches Settings modal");
assertIncludes(attention, "height: min(760px, calc(100dvh - 1rem));", "Attention owner modal height matches Settings modal");
assertIncludes(attention, "Close Check-in panel", "Attention owner modal close control");
assertIncludes(checkIn, "@container/checkin", "Check-in Tailwind named container");
assertIncludes(checkIn, "@min-[24rem]/checkin", "Check-in Tailwind container query");
assertIncludes(checkIn, "data-check-in-root", "Check-in component root marker");
assertIncludes(checkIn, "data-check-in-refresh", "Check-in refresh marker");
assertIncludes(checkIn, "data-check-in-details-toggle", "Check-in details toggle marker");
assertIncludes(checkIn, "data-check-in-details", "Check-in details panel marker");
assertIncludes(checkIn, "my-ax:check-in-details-expanded", "Check-in details persistence key");
assertIncludes(checkIn, "data-check-in-checked-at", "Check-in server timestamp marker");
assertIncludes(checkIn, "fetch(\"/api/check-in\"", "Check-in API fetch");
assertIncludes(checkIn, "checkedAt", "Check-in server timestamp field");
assertIncludes(checkIn, "Could not refresh Check-in", "Check-in refresh failure is explicit");
assertIncludes(checkIn, "Showing stale Check-in", "Check-in keeps stale data labeled as stale after refresh failure");
assertIncludes(checkIn, "Stale since", "Check-in stale timestamp label");
assertIncludes(checkIn, "data-check-in-version", "Check-in exposes deployment version chip for owner/debug correlation");
assertIncludes(checkIn, "shortVersion", "Check-in shortens deployment version ids for display");
assertIncludes(checkIn, "bucket.steer", "Check-in bucket singular steer field");
assertIncludes(checkIn, "data-check-in-raw-href={bucket.steer.href}", "Check-in raw API href preservation marker");
assertIncludes(checkIn, "displayCheckInHref", "Check-in rendered owner destination helper");
assertIncludes(checkIn, "href={displayCheckInHref(bucket.steer.href)}", "Check-in rendered owner destination href");
assertIncludes(displayHrefHelper, 'href.replace("/api/attention", "/attention")', "Check-in Attention display href preserves query string");
assertIncludes(displayHrefHelper, 'href.replace("/api/runs", "/runs")', "Check-in Runs display href preserves query string");
assertIncludes(displayHrefHelper, 'href.replace("/api/jobs", "/jobs")', "Check-in Jobs display href preserves query string");
assertIncludes(displayHrefTest, '"/api/attention?kind=job.complete"', "Check-in display href query-preservation test");
assertIncludes(displayHrefTest, '"/api/runs?status=failed"', "Check-in display href query-preservation test");
assertIncludes(displayHrefTest, '"/api/jobs?status=active"', "Check-in display href query-preservation test");
assertNotIncludes(checkIn, "bucket.steers", "Check-in bucket plural steers field");
assertIncludes(ssr, "data-check-in-root", "Check-in SSR output");
assertIncludes(ssr, "data-check-in-refresh", "Check-in SSR output");

console.log("✓ check-in shell smoke: Check-in bundle/markers exist without mounting a vertical strip in the chat shell");
