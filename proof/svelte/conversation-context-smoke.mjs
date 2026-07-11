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
assertIncludes(settings, 'Pick where each run lands: a new thread, this thread, or a specific thread you name.', "recurring jobs state the three destinations in UI");
assertIncludes(settings, '<option value="new_session_per_run">New thread each run</option>', "create form offers New thread");
assertIncludes(settings, '<option value="same_session">This thread</option>', "create form offers This thread");
assertIncludes(settings, '<option value="specific_session">Specific thread…</option>', "create form offers Specific thread");
assertIncludes(settings, 'threadMode: jobThreadMode', "recurring job creation persists the selected thread mode");
// Progressive disclosure: the thread-id input appears only for Specific.
assertIncludes(settings, 'jobThreadMode === "specific_session"', "specific thread id input is revealed only when Specific is selected");
assertIncludes(settings, 'openJobEdit(job)', "each job card exposes an Edit affordance");
assertIncludes(settings, 'data-job-destination={threadMode}', "job cards show a short destination summary");

console.log("✓ conversation context smoke: session model persistence and recurring-job thread copy are explicit");
