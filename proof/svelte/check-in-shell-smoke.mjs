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
const betaPage = read("src/views/BetaPage.tsx");
const betaApp = read("proof/svelte/BetaApp.svelte");
const attention = read("proof/svelte/Attention.svelte");
const checkIn = read("proof/svelte/CheckIn.svelte");
const displayHrefHelper = read("proof/svelte/check-in-display-href.ts");
const displayHrefTest = read("proof/svelte/check-in-display-href.test.ts");
const generatedBundles = read("proof/svelte/bundles.generated.ts");
const ssr = read("proof/svelte/CheckIn.ssr.mjs");

assertIncludes(buildConfig, "checkin: here(\"CheckIn.svelte\")", "Svelte build config");
assertIncludes(generatedBundles, "checkin", "generated Svelte bundles");
assertIncludes(generatedBundles, "data-check-in-raw-href", "generated Check-in raw API href marker");
assertNotIncludes(betaPage, "hydrateAs=\"checkin\"", "App shell Check-in mount that steals composer space");
assertNotIncludes(betaApp, "import CheckIn", "BetaApp does not embed CheckIn in the chat shell");
// B redesign: CheckIn is DECOUPLED from the notifications panel (the panel is
// now a pure notification stream). The CheckIn component + bundle are preserved
// for its own surface; it must no longer be embedded in Attention.
assertNotIncludes(attention, 'import CheckIn from "./CheckIn.svelte"', "Notifications panel no longer imports CheckIn");
assertNotIncludes(attention, "<CheckIn", "Notifications panel no longer embeds CheckIn");
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
// The helper rewrites the three API prefixes on a complete path-segment
// boundary (not a bare startsWith), preserving query/fragment suffixes.
assertIncludes(displayHrefHelper, '["attention", "runs", "jobs"]', "Check-in display href maps the three owner destinations");
assertIncludes(displayHrefHelper, '`/${seg}${href.slice(prefix.length)}`', "Check-in display href preserves the query/fragment suffix");
assertIncludes(displayHrefTest, '"/api/attention?kind=job.complete"', "Check-in display href query-preservation test");
assertIncludes(displayHrefTest, '"/api/runs?status=failed"', "Check-in display href query-preservation test");
assertIncludes(displayHrefTest, '"/api/jobs?status=active"', "Check-in display href query-preservation test");
assertNotIncludes(checkIn, "bucket.steers", "Check-in bucket plural steers field");
assertIncludes(ssr, "data-check-in-root", "Check-in SSR output");
assertIncludes(ssr, "data-check-in-refresh", "Check-in SSR output");

console.log("✓ check-in shell smoke: Check-in bundle/markers exist without mounting a vertical strip in the chat shell");
