#!/usr/bin/env node
import { readFileSync } from "node:fs";

const attention = readFileSync(new URL("./Attention.svelte", import.meta.url), "utf8");

function assertIncludes(haystack, needle, label) {
  if (!haystack.includes(needle)) throw new Error(`${label}: missing ${JSON.stringify(needle)}`);
}
function assertNotIncludes(haystack, needle, label) {
  if (haystack.includes(needle)) throw new Error(`${label}: unexpected ${JSON.stringify(needle)}`);
}

assertIncludes(attention, "data-attention-owner-backdrop", "Attention modal keeps a real backdrop");
assertIncludes(attention, "backdrop-blur-[3px]", "Attention backdrop matches Settings modal dim/blur language");
assertIncludes(attention, "top-[max(0.5rem,env(safe-area-inset-top))]", "Attention modal honors PWA safe-area top on mobile");
assertIncludes(attention, "bottom-[max(0.5rem,env(safe-area-inset-bottom))]", "Attention modal honors PWA safe-area bottom on mobile");
assertIncludes(attention, "safe-area-appbar flex min-h-[60px]", "Attention modal header uses safe-area appbar treatment");
assertIncludes(attention, "flex h-10 w-10 shrink-0", "Attention close button remains a 40px reachable target");
assertIncludes(attention, 'aria-modal="true"', "Attention dialog announces modal behavior");
assertNotIncludes(attention, "fixed left-1/2 top-2", "Attention modal must not use unsafe top-2 mobile placement");
assertNotIncludes(attention, "flex h-8 w-8", "Attention close button must not regress to a tiny target");

console.log("✓ attention modal smoke: Check-in/notifications modal uses safe-area Settings-style geometry");
