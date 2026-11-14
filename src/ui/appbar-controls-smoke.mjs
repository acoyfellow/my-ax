#!/usr/bin/env node
import { readFileSync } from "node:fs";

const appShell = readFileSync(new URL("./AppShell.svelte", import.meta.url), "utf8");
const attention = readFileSync(new URL("./Attention.svelte", import.meta.url), "utf8");
const navIconButton = readFileSync(new URL("./NavIconButton.svelte", import.meta.url), "utf8");
const appbarButtons = ["AppShell.svelte", "Desk.svelte", "Attention.svelte"].map((file) => [file, readFileSync(new URL(`./${file}`, import.meta.url), "utf8")]);

function assertIncludes(haystack, needle, label) {
  if (!haystack.includes(needle)) throw new Error(`${label}: missing ${JSON.stringify(needle)}`);
}

function assertNotIncludes(haystack, needle, label) {
  if (haystack.includes(needle)) throw new Error(`${label}: unexpected ${JSON.stringify(needle)}`);
}

assertIncludes(navIconButton, 'w-10 h-10 rounded-md', "appbar buttons use at least 40px tap targets");
assertIncludes(navIconButton, "width: 18px;", "appbar icons share one width");
assertIncludes(navIconButton, "height: 18px;", "appbar icons share one height");
for (const [file, source] of appbarButtons) assertIncludes(source, "<NavIconButton", `${file} uses the shared appbar button`);
assertIncludes(attention, 'h-10 w-10 flex-shrink-0', "Attention appbar slot uses at least 40px tap target");
assertNotIncludes(navIconButton, 'w-8 h-8 rounded-md', "appbar buttons must not regress to 32px tap targets");
assertNotIncludes(appShell, 'w-8 h-8 rounded-md', "AppShell appbar buttons must not regress to 32px tap targets");
assertNotIncludes(attention, 'w-8 h-8 rounded-md', "Attention bell must not regress to 32px tap target");

console.log("✓ appbar controls smoke: compact appbar controls stay at least 40px");
