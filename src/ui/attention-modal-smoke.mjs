#!/usr/bin/env node
import { readFileSync } from "node:fs";

const attention = readFileSync(new URL("./Attention.svelte", import.meta.url), "utf8");

function assertIncludes(haystack, needle, label) {
  if (!haystack.includes(needle)) throw new Error(`${label}: missing ${JSON.stringify(needle)}`);
}
function assertNotIncludes(haystack, needle, label) {
  if (haystack.includes(needle)) throw new Error(`${label}: unexpected ${JSON.stringify(needle)}`);
}

// Right-hand rail, not a modal: no dialog, no backdrop, content reflows beside it.
assertNotIncludes(attention, "<ModalPanel", "Notifications is a rail, not a modal");
assertIncludes(attention, "notif-rail", "Notifications renders as a right-hand rail");
assertIncludes(attention, "use:portal", "the rail mounts at the top layer, outside the app bar stack");
assertIncludes(attention, "--attention-dock-width", "the rail publishes its width so the conversation reflows");
assertIncludes(attention, 'event.key === "Escape"', "Escape closes the rail");

// B redesign: ONE unified chronological stream, no jargon, no tabs.
assertIncludes(attention, 'import {', "imports the pure notification-stream model");
assertIncludes(attention, "buildNotificationStream", "builds the unified stream from the pure model");
assertIncludes(attention, "unread notifications", "bell aria uses plain 'notifications' language");
assertIncludes(attention, 'selectedId ? "Notification" : "Notifications"', "panel title distinguishes the selected notification from the list");
assertIncludes(attention, "You're all caught up.", "empty state drops 'No recent pings' jargon");
assertIncludes(attention, "notif-list", "renders a single flat notification list");
assertIncludes(attention, "notif-pill", "each row carries a typed pill");
assertIncludes(attention, "/api/runs?status=failed&limit=8", "failed runs merge INTO the stream");

// Clearing: per-item dismiss + clear-all, incl. failed runs (the missing capability).
assertIncludes(attention, "notif-dismiss", "each row has a per-item dismiss control");
assertIncludes(attention, "/dismiss", "failed runs can be dismissed via the new endpoint");
assertIncludes(attention, "/api/runs/dismiss-all", "clear-all also dismisses failed runs");
assertIncludes(attention, "Clear all", "a single clear-all lives in the header");

assertIncludes(attention, "function showDetail(", "primary action opens the durable notification detail");
assertIncludes(attention, "data-notification-detail", "selected notification content has a stable detail marker");
assertIncludes(attention, "attentionSourceLabel", "conversation navigation is a secondary source action");
assertIncludes(attention, "my-ax:run-receipt-open", "run receipts remain available as a nested modal");

// The old jargon/tabs/CheckIn embed must be gone.
assertNotIncludes(attention, "attention-owner-nav", "the two-column tab nav is removed");
assertNotIncludes(attention, "<CheckIn", "CheckIn is no longer embedded in the notifications panel");
assertNotIncludes(attention, "Receipts", "the 'Receipts' jargon is gone");
assertNotIncludes(attention, "What needs you", "the 'What needs you' jargon is gone");
assertNotIncludes(attention, "Recent pings", "the 'Recent pings' jargon is gone");

console.log("✓ attention modal smoke: single unified notification stream in a right-hand rail");
