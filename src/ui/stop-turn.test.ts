import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chat = readFileSync(new URL("./Chat.svelte", import.meta.url), "utf8");
const agent = readFileSync(new URL("../pi-engine/pi-chat-agent.ts", import.meta.url), "utf8");

test("a live turn always shows a Stop button beside the timer, even while the composer has text", () => {
  assert.match(chat, /\{#if turnIsLive\}<button type="button" class="msg-duration__stop" data-stop-turn onclick=\{confirmStopTurn\}>Stop<\/button>\{\/if\}/);
});

test("Stop reaches the server over HTTP, so it works when the socket is down or the view thinks it is idle", () => {
  const body = chat.slice(chat.indexOf("function confirmStopTurn"), chat.indexOf("function cancelAgent"));
  assert.match(body, /cancelAgent\(\);\s*void stopTurnOnServer\(\);/);
  assert.match(chat, /\/api\/sessions\/\$\{encodeURIComponent\(sessionId\)\}\/stop`, \{ method: "POST"/);
});

test("stop aborts the run directly, and the stuck watchdog uses the same path", () => {
  const abort = agent.slice(agent.indexOf("async abortAll()"), agent.indexOf("private progressSample"));
  assert.match(abort, /await this\.harness\.abort\(\);/);
  assert.doesNotMatch(abort, /parked|retry\(\)/);
  assert.match(agent, /pi_turn_stuck_ended[^\n]*\n\s*await this\.abortAll\(\);/);
});

test("Go to decision hides its banner when clicked, and the X dismisses the decision on the server", () => {
  assert.match(chat, /\{#if pendingDecision && dismissedDecisionId !== pendingDecision\.id\}/);
  assert.match(chat, /data-decision-banner-close onclick=\{\(\) => \{ if \(!pendingDecision\) return; const id = pendingDecision\.id; dismissedDecisionId = id; pendingDecision = null; void dismissDecisionOnServer\(id, fetch\); \}\}/);
  assert.match(chat, /event\.preventDefault\(\); dismissedDecisionId = pendingDecision\.id; void focusDecision/);
});

test("an ask_user row starts open, even while it waits for the answer", () => {
  const body = chat.slice(chat.indexOf("function toolIsOpen"), chat.indexOf("function setToolOpen"));
  assert.match(body, /if \(tool\.id in toolOpen\) return toolOpen\[tool\.id\];\s*if \(tool\.name === "ask_user" \|\| widgetKind === "decision"\) return true;/);
});
