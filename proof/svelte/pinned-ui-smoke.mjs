#!/usr/bin/env node
// Locks the #2 pinned-conversations UI contract in Sessions.svelte: a distinct
// pinned group, a star pin/unpin action calling /pin, an accessible keyboard
// reorder handle calling /rank, and an aria-live announcement. Pure reorder
// logic is unit-tested in pinned-reorder.test.ts; this guards the wiring.
import { readFileSync } from "node:fs";

const s = readFileSync(new URL("./Sessions.svelte", import.meta.url), "utf8");
function has(needle, label) { if (!s.includes(needle)) throw new Error(`${label}: missing ${JSON.stringify(needle)}`); }

// Grouping
has('splitPinned(sessions).pinned', "pinned group derived from the shared session list");
has('>Pinned</div>', "a visible Pinned group header");
has('data-pinned={row.pinned === 1 ? "1" : "0"}', "rows expose their pinned state for styling/tests");
// Pin/unpin action -> server
has('/api/sessions/${encodeURIComponent(row.id)}/pin', "star action posts to the pin endpoint");
has('body: JSON.stringify({ pinned: nextPinned })', "pin action sends the boolean pinned state");
has('aria-pressed={row.pinned === 1}', "pin toggle exposes its pressed state");
// Reorder -> server, keyboard accessible
has('/api/sessions/${encodeURIComponent(movedId)}/rank', "reorder posts neighbor intent to the rank endpoint");
has('body: JSON.stringify({ beforeId })', "reorder sends beforeId neighbor intent (server computes the key)");
has('planKeyboardStep(order, row.id, direction)', "keyboard reorder uses the pure step planner");
has('e.key === "ArrowUp"', "reorder handle moves up with ArrowUp");
has('e.key === "ArrowDown"', "reorder handle moves down with ArrowDown");
// a11y live region
has('aria-live="polite" role="status">{pinAnnounce}', "an aria-live region announces pin/reorder changes");
has('class="session-row__reorder"', "pinned rows render a reorder handle");
// HTML5 drag-and-drop (C4): pointer parity, reuses planReorder + /rank.
has('draggable={pinnedGroup ? true : undefined}', "pinned rows are draggable (pointer reorder)");
has('ondrop={pinnedGroup ? (e) => onPinDrop(e, row) : undefined}', "pinned rows accept drops");
has('planReorder(order, moved, toIndex)', "drop maps to a beforeId via the shared pure planner");
has('void sendReorder(moved, plan.beforeId)', "drop persists the reorder via the same /rank path as keyboard");
// Optimistic + reconcile
has('refresh();', "server refresh reconciles optimistic pin/reorder changes");

console.log("✓ pinned UI smoke: pinned group + star pin/unpin + accessible keyboard reorder + aria-live, server-authoritative");
