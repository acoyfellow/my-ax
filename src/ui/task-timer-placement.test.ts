import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./Chat.svelte", import.meta.url), "utf8");

test("the running task timer sits in the chat thread, not above the composer", () => {
  const timer = source.indexOf("data-task-timer");
  const threadEnd = source.indexOf("</main>");
  const composer = source.indexOf("bind:this={formEl}");
  assert.notEqual(timer, -1);
  assert.ok(timer < threadEnd, "timer must render inside the thread");
  assert.ok(threadEnd < composer);
  assert.equal(source.indexOf("data-task-timer", timer + 1), -1, "only one timer");
});

test("the running timer reads like the finished turn's duration line", () => {
  assert.match(source, /class="msg msg-duration msg-duration--running" data-task-timer[^>]*>Running for \{taskElapsedText\}/);
});
