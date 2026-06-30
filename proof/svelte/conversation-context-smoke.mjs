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
assertIncludes(settings, 'Runs in this conversation on each tick.', "recurring jobs state current conversation attachment in UI");
assertIncludes(settings, 'future setting can start a fresh conversation per run', "recurring jobs name the missing new-conversation mode honestly");
assertNotIncludes(settings, 'starts a new conversation every tick', "UI must not claim new-conversation recurring jobs exist yet");

console.log("✓ conversation context smoke: session model persistence and recurring-job thread copy are explicit");
