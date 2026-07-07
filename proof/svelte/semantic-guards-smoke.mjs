#!/usr/bin/env node
import { readFileSync } from "node:fs";

const appShell = readFileSync(new URL("./AppShell.svelte", import.meta.url), "utf8");
const settings = readFileSync(new URL("./Settings.svelte", import.meta.url), "utf8");
const sessions = readFileSync(new URL("./Sessions.svelte", import.meta.url), "utf8");
const chat = readFileSync(new URL("./Chat.svelte", import.meta.url), "utf8");
const reconnectingSocket = readFileSync(new URL("./reconnecting-socket.ts", import.meta.url), "utf8");
const sw = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

function assertIncludes(haystack, needle, label) {
  if (!haystack.includes(needle)) throw new Error(`${label}: missing ${JSON.stringify(needle)}`);
}

assertIncludes(settings, 'Choose whether each tick continues this conversation or starts a fresh one.', "recurring job copy states explicit thread-mode choice");
assertIncludes(settings, 'Start a new conversation each run', "recurring job creation defaults to fresh per-run conversations");
assertIncludes(settings, 'Use this conversation', "recurring job creation still supports standing same-thread loops");
assertIncludes(settings, 'runs in this conversation', "existing same-session jobs are labeled honestly");
assertIncludes(settings, 'Delete this recurring job? Existing run receipts stay, but it will not run again.', "recurring job delete has explicit destructive confirmation");
assertIncludes(settings, 'aria-label={`Run ${job.name} now`}', "recurring job run action is accessible");
assertIncludes(settings, '>Run now</button>', "recurring job run action has a distinct text label");
assertIncludes(settings, '{job.status === "paused" ? "Resume" : "Pause"}</button>', "recurring job pause action has a distinct stateful text label");
assertIncludes(settings, '>Delete</button>', "recurring job delete action has a distinct text label");
assertIncludes(settings, 'class="job-action-button text-brand', "recurring job actions use labeled button styling");
assertIncludes(settings, '>Approve &amp; enable</button>', "pending reusable tools require a distinct owner approval action");
assertIncludes(settings, 'recipe.status !== "enabled"', "unapproved reusable tools stay unrunnable");
assertIncludes(settings, 'class="job-action-button min-h-[44px]', "reusable-tool actions keep mobile-sized labeled controls");
assertIncludes(appShell, 'if (title === sessionState.title) return cancelRename();', "unchanged conversation rename does not PATCH");
assertIncludes(sessions, 'return "reconnecting";', "session row distinguishes reconnecting from agent running");
assertIncludes(sessions, 'return "Reconnecting";', "session reconnecting label is honest about transport state");
assertIncludes(reconnectingSocket, 'return !manuallyClosed && socket === candidate;', "reconnecting transport gates every callback on the current, non-retired socket");
assertIncludes(reconnectingSocket, 'if (retryTimer !== null) dependencies.cancel(retryTimer);', "manual close cancels any scheduled reconnect timer");
assertIncludes(sessions, 'if (id === localStorage.getItem(SESSION_KEY)) {', "sidebar no-op switch compares against synchronous localStorage, not a stale snapshot");
assertIncludes(sessions, 'let currentId = $derived(sessionState.id);', "sidebar active identity is driven by the shared session store");
assertIncludes(chat, 'setConn("reconnecting");\n    ws = makeReconnectingSocket(', "in-place switch marks reconnecting synchronously until the new socket opens");
// H3: active-turn latch is session-bound and cleared on the way out.
assertIncludes(chat, 'activeTurnIsRestorable(saved, currentId)', "active-turn latch restore is gated by the session-bound freshness check");
assertIncludes(chat, 'forgetActiveTurn();\n    localStorage.setItem(SESSION_KEY, id);', "switchToSession clears the outgoing latch before flipping SESSION_KEY");
assertIncludes(chat, 'forgetActiveTurnFor(sessionId);\n      localStorage.setItem(SESSION_KEY, forkId);', "fork clears the parent latch before flipping SESSION_KEY");
// H4: pending-first-message is bound to its session.
assertIncludes(chat, 'sessionStorage.setItem("my-ax-pending-first-session", currentSessionId());', "pending first-message records the session it was typed for");
assertIncludes(chat, 'pendingFirstBelongsHere(pendingFirstSession, currentSessionId())', "pending first-message is only adopted by its bound session");
// H1: foreground half-open sockets force a reconnect, not just a ping.
assertIncludes(chat, 'setConn("reconnecting");\n          (ws as any)?.forceReconnect?.();', "stale foreground socket forces a reconnect instead of trusting a half-open pipe");
// H5b: async title writes are gated by the title epoch.
assertIncludes(chat, 'isTitleEpochCurrent(epoch)', "chat title refresh drops stale server titles via the title epoch");
assertIncludes(sessions, 'isTitleEpochCurrent(titleEpoch)', "sidebar refresh drops stale server titles via the title epoch");
// H2: bounded give-up terminal offline + retry.
assertIncludes(reconnectingSocket, 'callbacks.onExhausted?.({ attempts: attempt });', "reconnecting transport signals terminal exhaustion after maxAttempts");
assertIncludes(reconnectingSocket, 'resume()', "reconnecting transport exposes a resume affordance");
assertIncludes(chat, '{ maxAttempts: 8 }', "chat caps reconnection attempts at the agreed bound");
assertIncludes(chat, 'onExhausted() {', "chat consumes terminal exhaustion into a truthful offline pill");
assertIncludes(chat, 'Offline — tap to retry', "offline send control offers an explicit retry affordance");
// H6: service-worker navigation is single-path (ack + fallback).
assertIncludes(sw, 'my-ax:navigate-ack', "service worker waits for an in-page navigate ack before hard navigation");
assertIncludes(sw, 'if (!acked) await existing.navigate(absolute);', "service worker only hard-navigates when the app did not ack");
assertIncludes(chat, 'type: "my-ax:navigate-ack"', "chat acks service-worker navigation to prevent double-navigation");

console.log("✓ semantic guards smoke: durable deletes and no-op renames are explicit");
