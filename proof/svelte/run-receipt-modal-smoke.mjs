#!/usr/bin/env node
// Locks the Run Receipt nested-modal contract:
//   (1) the modal has a single bounded-height scroll container (header pinned,
//       body overflow-y:auto), and
//   (2) receipt navigation stays NESTED — Attention and Chat route /runs/<id>
//       to the modal event, never a full-page navigation, and Back is wired
//       through history push/pop.
import { readFileSync } from "node:fs";

const modal = readFileSync(new URL("./RunReceiptModal.svelte", import.meta.url), "utf8");
const appShell = readFileSync(new URL("./AppShell.svelte", import.meta.url), "utf8");
const attention = readFileSync(new URL("./Attention.svelte", import.meta.url), "utf8");
const chat = readFileSync(new URL("./Chat.svelte", import.meta.url), "utf8");

function assertIncludes(haystack, needle, label) {
  if (!haystack.includes(needle)) throw new Error(`${label}: missing ${JSON.stringify(needle)}`);
}
function assertNotIncludes(haystack, needle, label) {
  if (haystack.includes(needle)) throw new Error(`${label}: unexpected ${JSON.stringify(needle)}`);
}

// ── (1) Scroll container ────────────────────────────────────────────────────
assertIncludes(modal, "data-run-receipt-scroll", "modal must expose the scroll container");
assertIncludes(modal, "overflow-y: auto;", "modal body must scroll internally");
assertIncludes(modal, "overscroll-behavior: contain;", "modal scroll must not chain to the parent context");
assertIncludes(modal, "min-height: 0;", "flex scroll body needs min-height:0 to actually bound");
assertIncludes(modal, "max-height: calc(100dvh - max(1rem, env(safe-area-inset-top) + env(safe-area-inset-bottom)));", "modal must bound height to the safe visual viewport on mobile");
assertIncludes(modal, "flex: none;", "modal header must stay pinned (non-scrolling)");

// ── (2) Nested modal routing + Back semantics ───────────────────────────────
assertIncludes(modal, "showModal()", "receipt renders as a layered modal dialog");
assertIncludes(modal, 'history.pushState({ myAxRunReceipt: id }', "in-app open pushes a history entry so Back returns to the parent");
assertIncludes(modal, 'window.addEventListener("popstate"', "modal honors Back/forward via popstate");
assertIncludes(modal, "history.back()", "closing the modal steps back through the pushed entry");
assertIncludes(modal, "/api/runs/", "modal fetches receipt data from the JSON API (no full-page navigation)");
assertIncludes(modal, "const bootId = parseRunReceiptId(location.pathname);", "direct/deep link to /runs/<id> opens the modal over the shell on boot");

// The modal must be mounted in the always-present app shell so it can layer
// above either the conversation or the Attention panel.
assertIncludes(appShell, "import RunReceiptModal from \"./RunReceiptModal.svelte\";", "app shell imports the receipt modal");
assertIncludes(appShell, "<RunReceiptModal />", "app shell mounts the receipt modal");

// Attention: a receipt link opens the nested modal and does NOT close the panel
// or fall through to a page navigation.
assertIncludes(attention, 'window.dispatchEvent(new CustomEvent("my-ax:run-receipt-open", { detail: { runId: receipt } }));', "Attention routes /runs/<id> to the nested modal event");
{
  const followStart = attention.indexOf("function follow(");
  const followSlice = attention.slice(followStart, followStart + 700);
  const receiptBranch = followSlice.indexOf("my-ax:run-receipt-open");
  const closeCall = followSlice.indexOf("closePanel()");
  if (!(receiptBranch >= 0 && (closeCall === -1 || receiptBranch < closeCall))) {
    throw new Error("Attention must open the receipt modal BEFORE any closePanel/navigate fallback");
  }
}

// Chat: the deep-link follower opens the modal for /runs/<id> instead of
// location.assign (the previous full-page breakout).
assertIncludes(chat, 'window.dispatchEvent(new CustomEvent("my-ax:run-receipt-open", { detail: { runId: decodeURIComponent(receiptMatch[1]) } }));', "Chat routes receipt deep links to the nested modal");
{
  const followStart = chat.indexOf("const followDeepLink =");
  const followSlice = chat.slice(followStart, followStart + 1200);
  const receiptBranch = followSlice.indexOf("my-ax:run-receipt-open");
  const assign = followSlice.indexOf("location.assign(target.href)");
  if (!(receiptBranch >= 0 && assign >= 0 && receiptBranch < assign)) {
    throw new Error("Chat must handle /runs/<id> as a modal BEFORE the location.assign fallback");
  }
}

console.log("✓ run receipt modal smoke: bounded scroll container + nested modal routing with Back semantics");
