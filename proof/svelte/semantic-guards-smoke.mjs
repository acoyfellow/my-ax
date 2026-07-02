#!/usr/bin/env node
import { readFileSync } from "node:fs";

const appShell = readFileSync(new URL("./AppShell.svelte", import.meta.url), "utf8");
const settings = readFileSync(new URL("./Settings.svelte", import.meta.url), "utf8");
const sessions = readFileSync(new URL("./Sessions.svelte", import.meta.url), "utf8");

function assertIncludes(haystack, needle, label) {
  if (!haystack.includes(needle)) throw new Error(`${label}: missing ${JSON.stringify(needle)}`);
}

assertIncludes(settings, 'Choose whether each tick continues this conversation or starts a fresh one.', "recurring job copy states explicit thread-mode choice");
assertIncludes(settings, 'Start a new conversation each run', "recurring job creation defaults to fresh per-run conversations");
assertIncludes(settings, 'Use this conversation', "recurring job creation still supports standing same-thread loops");
assertIncludes(settings, 'runs in this conversation', "existing same-session jobs are labeled honestly");
assertIncludes(settings, 'Delete this recurring job? Existing run receipts stay, but it will not run again.', "recurring job delete has explicit destructive confirmation");
assertIncludes(settings, 'aria-label={`Run ${job.name} now`}', "recurring job run action is compact but accessible");
assertIncludes(settings, 'class="settings-icon-action text-brand', "recurring job action buttons share compact icon styling");
assertIncludes(appShell, 'if (title === sessionState.title) return cancelRename();', "unchanged conversation rename does not PATCH");
assertIncludes(sessions, 'return "reconnecting";', "session row distinguishes reconnecting from agent running");
assertIncludes(sessions, 'return "Reconnecting";', "session reconnecting label is honest about transport state");

console.log("✓ semantic guards smoke: durable deletes and no-op renames are explicit");
