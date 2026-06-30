#!/usr/bin/env node
import { readFileSync } from "node:fs";

const settings = readFileSync(new URL("./Settings.svelte", import.meta.url), "utf8");

function assertIncludes(haystack, needle, label) {
  if (!haystack.includes(needle)) throw new Error(`${label}: missing ${JSON.stringify(needle)}`);
}

function assertNotIncludes(haystack, needle, label) {
  if (haystack.includes(needle)) throw new Error(`${label}: unexpected ${JSON.stringify(needle)}`);
}

assertIncludes(settings, 'label: "Snippets"', "Settings navigation uses snippet naming");
assertIncludes(settings, 'Saved snippets', "Settings saved code section uses snippet naming");
assertIncludes(settings, 'codemode.search()', "Settings teaches codemode search");
assertIncludes(settings, 'codemode.describe(...)', "Settings teaches codemode describe");
assertIncludes(settings, 'codemode.run(...)', "Settings teaches codemode run");
assertNotIncludes(settings, 'recipe.list()', "Settings must not teach removed recipe.list surface");
assertNotIncludes(settings, 'recipe.run(...)', "Settings must not teach removed recipe.run surface");
assertNotIncludes(settings, 'tools: "recipe.list', "Capabilities card must not advertise removed recipe.list surface");
assertIncludes(settings, 'class="settings-icon-action text-brand', "saved snippet run action is a compact accessible icon button");
assertIncludes(settings, 'aria-label={`Run ${recipe.name}`}', "saved snippet run icon keeps an accessible label");
assertIncludes(settings, 'What the agent can use', "Capabilities tab uses plain purpose copy");
assertIncludes(settings, 'These are callable tools. They are not raw credentials.', "Capabilities tab separates mechanism from credentials");

console.log("✓ settings snippets smoke: Settings teaches codemode snippets with compact actions");
