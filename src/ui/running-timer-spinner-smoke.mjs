#!/usr/bin/env node
import { readFileSync } from "node:fs";

const chat = readFileSync(new URL("./Chat.svelte", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/app.css", import.meta.url), "utf8");

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

const timer = chat.match(/<div[^>]*data-task-timer[^>]*>[\s\S]*?<\/div>/)?.[0] ?? "";
assert(timer.length > 0, "the live turn line exists");
assert((timer.match(/agent-thinking__dot/g) ?? []).length === 3, "the live turn line leads with the three thinking dots");
assert(timer.includes("Running for {taskElapsedText}"), "the live turn line shows how long the turn has run");
assert(!timer.includes("SessionSignalDot"), "the live turn line has no spinner");
assert((chat.match(/class="agent-thinking__dot"/g) ?? []).length === 3, "the thinking dots render in one place only");
assert(/\.msg-duration--running \{[^}]*display: flex/.test(css), "the live turn line is a full-width flex row in the conversation column");
assert(/Ran for \{formatTurnDuration\(m\.durationMs\)\}/.test(chat), "a finished turn records how long it ran");

console.log("✓ live turn line smoke: thinking dots and Running for share one line, Ran for records the end");
