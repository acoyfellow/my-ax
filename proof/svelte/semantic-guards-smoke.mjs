#!/usr/bin/env node
import { readFileSync } from "node:fs";

const appShell = readFileSync(new URL("./AppShell.svelte", import.meta.url), "utf8");
const settings = readFileSync(new URL("./Settings.svelte", import.meta.url), "utf8");
const sessions = readFileSync(new URL("./Sessions.svelte", import.meta.url), "utf8");

function assertIncludes(haystack, needle, label) {
  if (!haystack.includes(needle)) throw new Error(`${label}: missing ${JSON.stringify(needle)}`);
}

assertIncludes(settings, 'Runs in this conversation on each tick.', "recurring job copy states current same-conversation behavior");
assertIncludes(settings, 'A future setting can start a fresh conversation per run', "recurring job copy names the missing thread-mode option honestly");
assertIncludes(settings, 'Delete this recurring job? Existing run receipts stay, but it will not run again.', "recurring job delete has explicit destructive confirmation");
assertIncludes(settings, 'aria-label={`Run ${job.name} now`}', "recurring job run action is compact but accessible");
assertIncludes(settings, 'class="settings-icon-action text-brand', "recurring job action buttons share compact icon styling");
assertIncludes(appShell, 'if (title === sessionState.title) return cancelRename();', "unchanged conversation rename does not PATCH");
assertIncludes(sessions, 'return "reconnecting";', "session row distinguishes reconnecting from agent running");
assertIncludes(sessions, 'return "Reconnecting";', "session reconnecting label is honest about transport state");

console.log("✓ semantic guards smoke: durable deletes and no-op renames are explicit");
