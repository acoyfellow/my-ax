#!/usr/bin/env node
import { readFileSync } from "node:fs";

const modal = readFileSync(new URL("./ModalPanel.svelte", import.meta.url), "utf8");
const root = readFileSync(new URL("./Root.svelte", import.meta.url), "utf8");

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

assert(/\.modal-panel__body\[data-fill="true"\]\s*\{[^}]*overflow:\s*hidden/.test(modal), "a fill modal body must not scroll; the chat inside it scrolls");
assert(/\.modal-panel__body\[data-fill="true"\]\s*\{[^}]*flex-direction:\s*column/.test(modal), "a fill modal body must be a flex column so its child can take the free height");
assert(modal.includes('data-fill={fill ? "true" : "false"}'), "ModalPanel exposes fill on the body");
assert(/<ModalPanel[^>]*\bfill\b/.test(root), "Root opts into a fill body so the input bar stays pinned");
assert(/\.root-content\s*\{[^}]*flex:\s*1[^}]*min-height:\s*0/.test(root), "root content must size from the body, not from its own content");
assert(!/\.root-content\s*\{[^}]*height:\s*100%/.test(root), "root content must not use height: 100%, which grows with a long chat");

console.log("✓ root panel fill smoke: the root input bar stays pinned in the modal");
