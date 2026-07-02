#!/usr/bin/env node
import { readFileSync } from "node:fs";

const chat = readFileSync(new URL("./Chat.svelte", import.meta.url), "utf8");
const settings = readFileSync(new URL("./Settings.svelte", import.meta.url), "utf8");
const sessionsRoute = readFileSync(new URL("../../src/routes/sessions.ts", import.meta.url), "utf8");

function assertIncludes(haystack, needle, label) {
  if (!haystack.includes(needle)) throw new Error(`${label}: missing ${JSON.stringify(needle)}`);
}

function assertNotIncludes(haystack, needle, label) {
  if (haystack.includes(needle)) throw new Error(`${label}: unexpected ${JSON.stringify(needle)}`);
}

assertIncludes(chat, '/api/sessions/${encodeURIComponent(sessionId)}/model', "chat persists model changes to the active session");
assertIncludes(chat, 'body: JSON.stringify({ model: modelState.current, reasoningEffort: modelState.reasoning }),', "chat sends model and reasoning effort when persisting session model");
assertIncludes(sessionsRoute, 'app.post("/api/sessions/:id/model"', "backend has a session model persistence route");
assertIncludes(sessionsRoute, 'await stub.setSessionModel(body.model, body.reasoningEffort);', "session model route forwards to the session agent");
assertIncludes(settings, 'Choose whether each tick continues this conversation or starts a fresh one.', "recurring jobs state explicit thread-mode choice in UI");
assertIncludes(settings, 'Start a new conversation each run', "recurring jobs expose new-conversation mode");
assertIncludes(settings, 'Use this conversation', "recurring jobs expose standing same-conversation mode");
assertIncludes(settings, 'threadMode: jobThreadMode', "recurring job creation persists the selected thread mode");

console.log("✓ conversation context smoke: session model persistence and recurring-job thread copy are explicit");
