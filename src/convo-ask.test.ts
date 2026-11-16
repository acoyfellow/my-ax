import assert from "node:assert/strict";
import test from "node:test";
import { askMessages, cleanAnswer, fallbackAnswer, isQuestion, midTurnAction, summarizeLiveState } from "./convo-ask";

test("questions are told apart from instructions", () => {
  for (const q of ["What are you doing?", "how long left", "is it deployed", "status", "any luck?", "did the tests pass"]) assert.equal(isQuestion(q), true, q);
  for (const t of ["Use a blue border too", "stop after the tests", "also update the README", ""]) assert.equal(isQuestion(t), false, t);
});

test("each mid-turn rule picks an action", () => {
  assert.equal(midTurnAction("queue", "anything"), "queue");
  assert.equal(midTurnAction("steer", "what now?"), "steer");
  assert.equal(midTurnAction("interrupt", "use blue"), "interrupt");
  assert.equal(midTurnAction("ask", "what are you doing?"), "ask");
  assert.equal(midTurnAction("ask", "use a blue border"), "steer");
});

test("the live state summary keeps tools, the partial reply and recent entries", () => {
  const summary = summarizeLiveState({
    busy: true,
    tools: [{ toolName: "work_code" }],
    partial: { content: [{ type: "text", text: "Found the cause" }] },
    entries: [
      { message: { role: "user", content: "fix the widget height" } },
      { message: { role: "assistant", content: [{ type: "text", text: "Reading the frame CSS" }] } },
    ],
  });
  assert.match(summary, /Agent is working\./);
  assert.match(summary, /Running now: work_code\./);
  assert.match(summary, /Writing now: Found the cause/);
  assert.match(summary, /user: fix the widget height/);
  assert.match(summary, /assistant: Reading the frame CSS/);
});

test("the summary is bounded", () => {
  const big = "x".repeat(5000);
  const summary = summarizeLiveState({ busy: true, entries: Array.from({ length: 20 }, () => ({ message: { role: "assistant", content: big } })) });
  assert.ok(summary.length <= 2100, `summary length ${summary.length}`);
});

test("the ask prompt carries the proof rule and the state", () => {
  const [system, user] = askMessages("Agent is working.", "is it deployed?");
  assert.match(system.content, /Never say something is done, fixed, deployed or merged unless the state shows a result that proves it/);
  assert.match(system.content, /STATE:\nAgent is working\./);
  assert.equal(user.content, "is it deployed?");
});

test("the fallback never claims completion", () => {
  assert.match(fallbackAnswer({ busy: true, tools: [{ name: "deploy" }] }), /running deploy/);
  assert.match(fallbackAnswer({ busy: true }), /No result to report yet/);
  assert.doesNotMatch(fallbackAnswer({ busy: true }), /done|deployed|fixed/i);
  assert.equal(cleanAnswer("  hi   there "), "hi there");
});
