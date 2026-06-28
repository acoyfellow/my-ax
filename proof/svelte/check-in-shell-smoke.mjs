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
const checkIn = read("proof/svelte/CheckIn.svelte");
const generatedBundles = read("proof/svelte/bundles.generated.ts");
const ssr = read("proof/svelte/CheckIn.ssr.mjs");

assertIncludes(buildConfig, "checkin: here(\"CheckIn.svelte\")", "Svelte build config");
assertIncludes(generatedBundles, "checkin", "generated Svelte bundles");
assertIncludes(generatedBundles, "data-check-in-raw-href", "generated Check-in raw API href marker");
assertIncludes(chatPage, "hydrateAs=\"checkin\"", "Chat shell Check-in mount");
assertIncludes(checkIn, "data-check-in-root", "Check-in component root marker");
assertIncludes(checkIn, "data-check-in-refresh", "Check-in refresh marker");
assertIncludes(checkIn, "data-check-in-details-toggle", "Check-in details toggle marker");
assertIncludes(checkIn, "data-check-in-details", "Check-in details panel marker");
assertIncludes(checkIn, "my-ax:check-in-details-expanded", "Check-in details persistence key");
assertIncludes(checkIn, "data-check-in-checked-at", "Check-in server timestamp marker");
assertIncludes(checkIn, "fetch(\"/api/check-in\"", "Check-in API fetch");
assertIncludes(checkIn, "checkedAt", "Check-in server timestamp field");
assertIncludes(checkIn, "bucket.steer", "Check-in bucket singular steer field");
assertIncludes(checkIn, "data-check-in-raw-href={bucket.steer.href}", "Check-in raw API href preservation marker");
assertIncludes(checkIn, "href={displayHref(bucket.steer.href)}", "Check-in rendered owner destination href");
assertNotIncludes(checkIn, "bucket.steers", "Check-in bucket plural steers field");
assertIncludes(ssr, "data-check-in-root", "Check-in SSR output");
assertIncludes(ssr, "data-check-in-refresh", "Check-in SSR output");

console.log("✓ check-in shell smoke: shell mounts Check-in, built bundle exists, SSR contains root + refresh markers");
