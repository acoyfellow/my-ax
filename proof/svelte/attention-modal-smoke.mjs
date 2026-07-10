#!/usr/bin/env node
import { readFileSync } from "node:fs";

const attention = readFileSync(new URL("./Attention.svelte", import.meta.url), "utf8");

function assertIncludes(haystack, needle, label) {
  if (!haystack.includes(needle)) throw new Error(`${label}: missing ${JSON.stringify(needle)}`);
}
function assertNotIncludes(haystack, needle, label) {
  if (haystack.includes(needle)) throw new Error(`${label}: unexpected ${JSON.stringify(needle)}`);
}

// Native dialog primitive + backdrop language (shared with Settings).
assertIncludes(attention, "<dialog", "Notifications uses the native dialog primitive");
assertIncludes(attention, "bind:this={dialogEl}", "Notifications dialog is controlled through the native dialog API");
assertIncludes(attention, ".notif-panel::backdrop", "Notifications uses the native dialog backdrop pseudo-element");
assertIncludes(attention, "background: rgb(0 0 0 / 0.56);", "backdrop matches Settings dim strength");
assertIncludes(attention, "backdrop-filter: blur(3px);", "backdrop matches Settings blur language");
assertIncludes(attention, "inset: max(0.5rem, env(safe-area-inset-top)) auto auto 50%;", "panel honors PWA safe-area top");

// B redesign: ONE unified chronological stream, no jargon, no tabs.
assertIncludes(attention, 'import {', "imports the pure notification-stream model");
assertIncludes(attention, "buildNotificationStream", "builds the unified stream from the pure model");
assertIncludes(attention, "unread notifications", "bell aria uses plain 'notifications' language");
assertIncludes(attention, ">Notifications<", "panel title is plainly 'Notifications'");
assertIncludes(attention, "You're all caught up.", "empty state drops 'No recent pings' jargon");
assertIncludes(attention, "notif-list", "renders a single flat notification list");
assertIncludes(attention, "notif-pill", "each row carries a typed pill");
assertIncludes(attention, "/api/runs?status=failed&limit=8", "failed runs merge INTO the stream");

// Clearing: per-item dismiss + clear-all, incl. failed runs (the missing capability).
assertIncludes(attention, "notif-dismiss", "each row has a per-item dismiss control");
assertIncludes(attention, "/dismiss", "failed runs can be dismissed via the new endpoint");
assertIncludes(attention, "/api/runs/dismiss-all", "clear-all also dismisses failed runs");
assertIncludes(attention, "Clear all", "a single clear-all lives in the header");

// Actions: primary=conversation (follow), secondary=widget/receipt modal.
assertIncludes(attention, "function follow(", "primary action navigates to the conversation/deep-link");
assertIncludes(attention, "my-ax:run-receipt-open", "secondary action opens the run receipt as a nested modal");
assertIncludes(attention, "openWidget", "a secondary 'View' action opens the widget/artifact");

// Mobile geometry: single scroll region, bottom sheet, no two-column nav.
assertIncludes(attention, "overscroll-behavior: contain;", "one bounded scroll region");
assertIncludes(attention, "border-radius: 16px 16px 0 0;", "mobile bottom-sheet corners");
assertIncludes(attention, "max-width: 100vw;", "mobile sheet overrides the UA dialog:modal max-width so it is truly full-width");
assertIncludes(attention, "inset: auto 0 0 0;", "mobile sheet pins to both viewport edges + bottom");

// The old jargon/tabs/CheckIn embed must be gone.
assertNotIncludes(attention, "attention-owner-nav", "the two-column tab nav is removed");
assertNotIncludes(attention, "<CheckIn", "CheckIn is no longer embedded in the notifications panel");
assertNotIncludes(attention, "Receipts", "the 'Receipts' jargon is gone");
assertNotIncludes(attention, "What needs you", "the 'What needs you' jargon is gone");
assertNotIncludes(attention, "Recent pings", "the 'Recent pings' jargon is gone");

console.log("✓ attention modal smoke: single unified notification stream (typed rows, dismissable, mobile sheet)");
