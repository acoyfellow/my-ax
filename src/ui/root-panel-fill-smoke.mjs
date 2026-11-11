#!/usr/bin/env node
import { readFileSync } from "node:fs";

const root = readFileSync(new URL("./Root.svelte", import.meta.url), "utf8");
const chat = readFileSync(new URL("./Chat.svelte", import.meta.url), "utf8");

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

assert(!root.includes("<ModalPanel"), "root is a top drawer, not a modal");
assert(!root.includes("maximizable"), "the root drawer has no maximize button");
assert(/\.root-drawer\s*\{[^}]*height:\s*calc\(100dvh - var\(--page-composer-height/.test(root), "the drawer stops above the page input bar");
assert(/\.root-scrim\s*\{[^}]*inset:\s*0 0 var\(--page-composer-height/.test(root), "the backdrop leaves the page input bar clickable");
assert(root.includes("composerHidden") && root.includes("registerRootSender"), "root hides its own input and borrows the page input bar");
assert(chat.includes("shouldSendToRoot(binding.followsTab, composerRoute)"), "the page input bar forwards to root while the drawer is open");
assert(/\.root-content\s*\{[^}]*flex:\s*1[^}]*min-height:\s*0/.test(root), "root content sizes from the drawer, not from its own content");

console.log("✓ root drawer smoke: top drawer, no maximize, shared always-visible input bar");
