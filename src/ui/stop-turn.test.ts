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

test("abort releases a task the restart limit parked, then aborts it, and the stuck watchdog uses the same path", () => {
  const abort = agent.slice(agent.indexOf("async abortAll()"), agent.indexOf("private progressSample"));
  assert.match(abort, /operation\.status === "parked"/);
  assert.match(abort, /session\(\)\.retry\(\);\s*await this\.harness\.abort\(\);/);
  assert.match(agent, /pi_turn_stuck_ended[^\n]*\n\s*await this\.abortAll\(\);/);
});
