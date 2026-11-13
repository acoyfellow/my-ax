import assert from "node:assert/strict";
import test from "node:test";
import { gateSession, SpokenRecord } from "./voice-echo-gate";
import { speakable } from "./voice-speakable";

const clock = () => {
  let now = 1_000_000;
  return { now: () => now, advance: (ms: number) => (now += ms) };
};

const recorder = () => {
  const calls: string[] = [];
  const options = {
    onSpeechStart: (text?: string) => { calls.push(`start:${text ?? ""}`); },
    onInterim: (text: string) => { calls.push(`interim:${text}`); },
    onUtterance: (text: string) => { calls.push(`utterance:${text}`); },
  };
  return { calls, options };
};

test("speech goes straight through when the agent is quiet", () => {
  const { calls, options } = recorder();
  const gated = gateSession(options, new SpokenRecord(clock().now), () => undefined);
  gated.onSpeechStart?.("");
  gated.onUtterance?.("turn into a heart");
  assert.deepEqual(calls, ["start:", "utterance:turn into a heart"]);
});

test("the agent hearing its own sentence through the speaker is dropped", () => {
  const record = new SpokenRecord(clock().now);
  const { calls, options } = recorder();
  const events: string[] = [];
  const gated = gateSession(options, record, (event) => { events.push(event); });
  record.turnStarted();
  record.spoke("Loud and clear. What can I do for you?");
  gated.onSpeechStart?.("");
  gated.onInterim?.("loud and");
  gated.onInterim?.("loud and clear");
  gated.onUtterance?.("Loud and clear.");
  assert.deepEqual(calls, []);
  assert.deepEqual(events, ["barge-held", "echo-dropped"]);
});

test("a short noise while the agent speaks is held, not treated as an interruption", () => {
  const record = new SpokenRecord(clock().now);
  const { calls, options } = recorder();
  const gated = gateSession(options, record, () => undefined);
  record.turnStarted();
  record.spoke("Here is a long story about a lighthouse keeper.");
  gated.onSpeechStart?.("");
  gated.onInterim?.("uh");
  gated.onUtterance?.("uh");
  assert.deepEqual(calls, []);
});

test("a real interruption passes once it has enough new words", () => {
  const record = new SpokenRecord(clock().now);
  const { calls, options } = recorder();
  const gated = gateSession(options, record, () => undefined);
  record.turnStarted();
  record.spoke("Here is a long story about a lighthouse keeper.");
  gated.onSpeechStart?.("");
  gated.onInterim?.("wait");
  gated.onInterim?.("wait stop please");
  gated.onUtterance?.("Wait, stop please.");
  assert.deepEqual(calls, ["start:wait stop please", "interim:wait stop please", "utterance:Wait, stop please."]);
});

test("guarding ends a moment after the last sentence has played", () => {
  const time = clock();
  const record = new SpokenRecord(time.now);
  record.turnStarted();
  record.spoke("Yes.");
  record.turnEnded();
  assert.equal(record.agentAudible(), true);
  time.advance(5_000);
  assert.equal(record.agentAudible(), false);
});

test("echo needs the same words in the same order, so a real follow-up survives", () => {
  const record = new SpokenRecord(() => 1000);
  record.spoke("Got it, I like that you like jazz. I'll keep that in mind. What is on your mind?");
  assert.equal(record.isEcho("Forget that I like jazz."), false);
  assert.equal(record.isEcho("What is my name?"), false);
  assert.equal(record.isEcho("I'll keep that in mind"), true);
});

test("an interruption cuts the remembered speech short so later talk is not mistaken for echo", () => {
  const time = clock();
  const record = new SpokenRecord(time.now);
  record.spoke("This is a very long answer that would take many seconds to read out loud.");
  record.silenced();
  time.advance(1_500);
  assert.equal(record.agentAudible(), false);
});

test("speech text drops markdown, code, links and tool JSON, and spells out acronyms", () => {
  assert.equal(speakable("**Done.** See [the docs](https://x.dev) and `npm run check`."), "Done. See the docs and npm run check.");
  assert.equal(speakable("```ts\nconst a = 1;\n```\nShipped."), "Shipped.");
  assert.equal(speakable('Calling {"name":"exec","args":{}} now'), "Calling now");
  assert.equal(speakable("The MCP server is up"), "The M C P server is up");
  assert.equal(speakable("- one\n- two"), "one two");
});
