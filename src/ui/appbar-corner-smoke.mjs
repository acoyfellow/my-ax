import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shell = readFileSync(new URL("./AppShell.svelte", import.meta.url), "utf8");
const sessions = readFileSync(new URL("./Sessions.svelte", import.meta.url), "utf8");

assert.ok(shell.includes("bind:offsetHeight={appBarHeight}"), "the app bar measures its own height");
assert.ok(shell.includes('setProperty("--appbar-height"'), "the app bar publishes --appbar-height");
assert.ok(sessions.includes("top-[var(--appbar-height,52px)]"), "the docked sidebar starts at the measured app bar edge");
assert.ok(!sessions.includes("fixed z-30 top-[52px]"), "the docked sidebar must not hard-code the app bar height");

console.log("appbar corner: sidebar top follows the measured app bar height");
