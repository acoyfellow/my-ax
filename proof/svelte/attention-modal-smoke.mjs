#!/usr/bin/env node
import { readFileSync } from "node:fs";

const attention = readFileSync(new URL("./Attention.svelte", import.meta.url), "utf8");

function assertIncludes(haystack, needle, label) {
  if (!haystack.includes(needle)) throw new Error(`${label}: missing ${JSON.stringify(needle)}`);
}
function assertNotIncludes(haystack, needle, label) {
  if (haystack.includes(needle)) throw new Error(`${label}: unexpected ${JSON.stringify(needle)}`);
}

assertIncludes(attention, "<dialog", "Attention modal uses the same native dialog primitive as Settings");
assertIncludes(attention, "bind:this={dialogEl}", "Attention dialog is controlled through the native dialog API");
assertIncludes(attention, ".attention-owner-panel::backdrop", "Attention modal uses the native dialog backdrop pseudo-element");
assertIncludes(attention, "background: rgb(0 0 0 / 0.56);", "Attention backdrop matches Settings dim strength");
assertIncludes(attention, "backdrop-filter: blur(3px);", "Attention backdrop matches Settings blur language");
assertIncludes(attention, "inset: max(0.5rem, env(safe-area-inset-top)) auto auto 50%;", "Attention modal honors PWA safe-area top with Settings geometry");
assertIncludes(attention, "height: min(760px, calc(100dvh - 1rem));", "Attention modal matches Settings height contract");
assertIncludes(attention, ".attention-owner-panel { top: 6vh; }", "Attention modal matches Settings desktop top offset");
assertIncludes(attention, "width: calc(100vw - 1rem);", "Attention modal matches Settings mobile width contract");
assertIncludes(attention, "height: calc(100dvh - max(1rem, env(safe-area-inset-top) + env(safe-area-inset-bottom)));", "Attention modal matches Settings mobile safe-area height contract");
assertIncludes(attention, "border-radius: 14px;", "Attention modal matches Settings mobile radius contract");
assertIncludes(attention, "min-height: 68px;", "Attention modal header matches Settings desktop height");
assertIncludes(attention, "padding: 12px 14px;", "Attention modal header matches Settings desktop padding");
assertIncludes(attention, "min-height: 60px; padding: 9px; gap: 8px;", "Attention modal header matches Settings mobile padding");
assertIncludes(attention, "min-height: 40px;", "Attention close button matches Settings mobile target");
assertIncludes(attention, "attention-owner-layout grid flex-1 min-h-0 overflow-hidden", "Attention uses Settings modal layout grid");
assertIncludes(attention, "grid-template-columns: 190px minmax(0, 1fr);", "Attention desktop nav/content split matches Settings");
assertIncludes(attention, "attention-owner-nav", "Attention has Settings-style section navigation");
assertIncludes(attention, "data-attention-owner-content", "Attention has a dedicated Settings-style scroll content pane");
assertIncludes(attention, "Now", "Attention uses the two-act Now tab from the Check-in header narrative");
assertIncludes(attention, "Receipts", "Attention uses one receipt stream instead of overlapping Failed runs and Notifications tabs");
assertIncludes(attention, "Failed runs", "Attention includes failed run review in the Receipts tab");
assertIncludes(attention, "/api/runs?status=failed&limit=8", "Attention loads failed run receipts inline instead of forcing the Runs page first");
assertIncludes(attention, "isFailedRunsHref", "Attention detects failed-runs Check-in CTA links");
assertIncludes(attention, "activeSection = \"receipts\"", "Attention switches failed-work CTA into the Receipts tab instead of routing away");
assertIncludes(attention, "onclick={handlePanelClick}", "Attention captures Check-in CTA clicks inside the modal content pane");
assertIncludes(attention, "attention-owner-section", "Attention tabs share a section layout primitive");
assertIncludes(attention, "attention-owner-section-header", "Attention tabs share a header primitive");
assertIncludes(attention, "attention-owner-card", "Attention tabs share a card primitive");
assertIncludes(attention, "Open source receipt", "Failed run cards use a secondary source-receipt action");
assertIncludes(attention, "attention-owner-secondary-action", "Receipts uses the same secondary action grammar");
assertIncludes(attention, "<CheckIn embedded />", "Now tab embeds Check-in without the competing standalone receipt expander");
assertNotIncludes(attention, "attention-owner-count", "Attention nav must not show mixed-unit tab counts");
assertNotIncludes(attention, "data-attention-owner-backdrop", "Attention must not use a separate fixed backdrop button");
assertNotIncludes(attention, "fixed inset-0 z-40", "Attention must not reintroduce the old fixed backdrop layer");
assertNotIncludes(attention, "fixed left-1/2 top-2", "Attention modal must not use unsafe top-2 mobile placement");
assertNotIncludes(attention, "flex h-8 w-8", "Attention close button must not regress to a tiny target");

console.log("✓ attention modal smoke: Check-in/notifications modal uses native Settings-style dialog/backdrop geometry");
