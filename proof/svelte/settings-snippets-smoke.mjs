#!/usr/bin/env node
import { readFileSync } from "node:fs";

const settings = readFileSync(new URL("./Settings.svelte", import.meta.url), "utf8");

function assertIncludes(haystack, needle, label) {
  if (!haystack.includes(needle)) throw new Error(`${label}: missing ${JSON.stringify(needle)}`);
}

function assertNotIncludes(haystack, needle, label) {
  if (haystack.includes(needle)) throw new Error(`${label}: unexpected ${JSON.stringify(needle)}`);
}

assertIncludes(settings, 'label: "Reusable tools"', "Settings navigation uses the owner-facing term");
assertIncludes(settings, '>Reusable tools</span>', "Settings saved-code section uses the owner-facing term");
assertIncludes(settings, 'status: "pending" | "enabled" | "disabled"', "Settings models every saved-tool status");
assertIncludes(settings, '? "Pending" : recipe.status === "enabled" ? "Enabled" : "Disabled"', "status pills use understandable labels");
assertIncludes(settings, '>Approve &amp; enable</button>', "pending tools have one deliberate approval action");
assertIncludes(settings, 'Enable new tools automatically', "owners can choose automatic enablement");
assertIncludes(settings, 'Let me review it first', "owners can return to review-first mode");
assertIncludes(settings, 'fetch("/api/recipes/preferences"', "approval preference is persisted through the owner-scoped API");
assertIncludes(settings, '/approval`, {', "approval uses the semantic owner-scoped endpoint");
assertIncludes(settings, 'body: JSON.stringify({ action: "approve" })', "approval sends the explicit approve action");
assertIncludes(settings, 'recipe.status !== "enabled"', "pending and disabled tools remain unrunnable");
assertIncludes(settings, 'detail?.recipeName ?? query.get("recipe")', "card and URL review requests select the proposed tool");
assertIncludes(settings, 'class="job-action-button min-h-[44px]', "reusable-tool actions are labeled mobile tap targets");
assertIncludes(settings, '>Run</button>', "run action has visible text");
assertIncludes(settings, '>Review</button>', "review action has visible text");
assertIncludes(settings, '>Delete</button>', "delete action has visible text");
assertIncludes(settings, 'Enabled tools can run in future tasks', "Settings explains the user outcome instead of implementation APIs");
assertNotIncludes(settings, 'recipe.list()', "Settings must not teach removed recipe.list surface");
assertNotIncludes(settings, 'recipe.run(...)', "Settings must not teach removed recipe.run surface");
assertNotIncludes(settings, 'tools: "recipe.list', "Capabilities card must not advertise removed recipe.list surface");
assertIncludes(settings, 'What the agent can use', "Capabilities tab uses plain purpose copy");
assertIncludes(settings, 'These are callable tools. They are not raw credentials.', "Capabilities tab separates mechanism from credentials");

console.log("✓ reusable tools settings smoke: owner-selectable approval mode, explicit approval, and labeled mobile actions");
