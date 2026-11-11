#!/usr/bin/env node
import { readFileSync } from "node:fs";

const chat = readFileSync(new URL("./Chat.svelte", import.meta.url), "utf8");
const signal = readFileSync(new URL("./SessionSignal.svelte", import.meta.url), "utf8");

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

const timer = chat.match(/<div[^>]*data-task-timer[^>]*>[\s\S]*?<\/div>/)?.[0] ?? "";
assert(timer.length > 0, "the running timer exists");
assert(timer.includes('<SessionSignalDot signal="running" />'), "the running timer leads with the shared spinning ring");
assert(timer.indexOf("<SessionSignalDot") < timer.indexOf("Running for"), "the ring comes before the text");
assert(/data-signal="running"[\s\S]*animation:\s*session-signal-spin/.test(signal) || /\[data-signal="running"\]\)\s*\{[^}]*animation:/.test(signal), "the shared ring spins");
assert(/prefers-reduced-motion[\s\S]*session-row__signal\[data-signal="running"\]/.test(signal), "reduced motion slows the ring");

console.log("✓ running timer spinner smoke: the Running for timer shows the shared spinning ring");
