import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const chat = readFileSync(new URL("./Chat.svelte", import.meta.url), "utf8");

test("a 404 from the engine lookup is reported as a missing session, not swallowed", () => {
  assert.match(chat, /if \(response\.status === 404\) return "missing";/);
});

test("bootstrap stops and shows not-found instead of opening a socket for a missing session", () => {
  assert.match(chat, /else if \(\(await learnSessionEngine\(sessionId\)\) === "missing"\) return showMissingSession\(sessionId\);/);
});

test("switching to a missing session from inside the app also shows not-found", () => {
  assert.match(chat, /lookup === "missing" \? showMissingSession\(id\) : switchToSessionKnownEngine\(id\)/);
});

test("the missing-session state clears the bad id, drops the resume spinner, and offers a new conversation", () => {
  const body = chat.slice(chat.indexOf("function showMissingSession"), chat.indexOf("function chatSocketUrl"));
  for (const step of ["writeTabSession(null)", "setActiveSession(null)", "bootstrapPending = false", "sessionResumeVisible = false"]) assert.ok(body.includes(step), step);
  assert.match(chat, /data-session-missing[\s\S]*Conversation not found[\s\S]*Start a new conversation/);
});
