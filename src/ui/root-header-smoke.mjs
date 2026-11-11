#!/usr/bin/env node
import { readFileSync } from "node:fs";

const root = readFileSync(new URL("./Root.svelte", import.meta.url), "utf8");
const modal = readFileSync(new URL("./ModalPanel.svelte", import.meta.url), "utf8");
const sessions = readFileSync(new URL("./Sessions.svelte", import.meta.url), "utf8");

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

const headerStart = root.indexOf('<div class="root-drawer__header">');
const header = root.slice(headerStart, root.indexOf('<div class="root-content">'));
const outsideMenu = header.replace(/\{#if menuOpen\}[\s\S]*?\{\/if\}/, "");
assert(headerStart > 0, "Root renders its own header");
assert(header.indexOf("<SessionSignalDot") >= 0 && header.indexOf("<SessionSignalDot") < header.indexOf("data-root-menu"), "the status dot comes first, then the ... menu");
assert(header.includes("data-root-clear"), "Clear lives inside the ... menu");
assert(!outsideMenu.includes("clear()"), "Clear is not a top-level header button");
assert(sessions.includes("<SessionSignalDot"), "the conversation list and Root share one status component");
assert(/\.modal-panel__icon\)\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/.test(modal), "modal header icon buttons match the 44px + button");
assert(/\.root-drawer__icon\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/.test(root), "root drawer icon buttons match the 44px + button");
assert(!modal.includes(">×</button>") && !modal.includes('"⤡" : "⤢"'), "close and maximize use SVG icons, not text glyphs");
assert(!root.includes(">⧉<"), "no text glyph icons in root");

console.log("✓ root header smoke: status dot, ... menu with Clear, 44px icon buttons");
