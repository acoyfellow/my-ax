import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { extractCompleteSentences, runLayeredVoiceTurn, VOICE_APPROVAL_LINE, type VoiceLayerChat, type VoiceTurnProgress } from "./voice-layers";

type Script = VoiceTurnProgress[];

function fakeChat(script: Script) {
  const frames: string[] = [];
  const submitted: string[] = [];
  let polls = 0;
  let release: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => { release = resolve; });
  const chat: VoiceLayerChat = {
    async submit(text) { submitted.push(text); return { operationId: "op-1" }; },
    async wait() { await finished; return { status: "done", text: "Final answer here." }; },
    async voiceTurnProgress() {
      if (polls === 0) { polls += 1; return { busy: false, lastEntryId: 0, entries: [], partial: null }; }
      const step = script[Math.min(polls - 1, script.length - 1)];
      polls += 1;
      if (polls > script.length) release();
      return step;
    },
    async broadcastFrame(frame) { frames.push(frame); },
    async abortAll() { return undefined; },
  };
  return { chat, frames, submitted };
}

const assistant = (id: number, content: unknown[]) => ({ id, model: [{ role: "assistant", content }] });
const progress = (entries: ReturnType<typeof assistant>[], partial: unknown = null): VoiceTurnProgress => ({ busy: true, lastEntryId: entries.length, entries, partial });

test("extractCompleteSentences strips markdown, code and links", () => {
  const text = "## Title\n**Bold** move with [a link](https://x.io) done. ```js\nconst a = 1;\n``` Second one! Third sentence. Trailing";
  assert.deepEqual(extractCompleteSentences(text, false), ["Title Bold move with a link done.", "Second one!"]);
  assert.deepEqual(extractCompleteSentences("Only partial words", false), []);
  assert.deepEqual(extractCompleteSentences("Only partial words", true), ["Only partial words"]);
});

test("zero layers yields nothing and never touches the chat or ai", async () => {
  const { chat, submitted } = fakeChat([]);
  let aiCalls = 0;
  const ai = { async run() { aiCalls += 1; return {}; } };
  const out: string[] = [];
  for await (const line of runLayeredVoiceTurn({ layers: [], transcript: "hi", chat, ai })) out.push(line);
  assert.deepEqual(out, []);
  assert.equal(aiCalls, 0);
  assert.deepEqual(submitted, []);
});

test("one layer speaks opener first, narrates tools once, flags approval, streams sentences and emits metrics", async () => {
  const tool = (id: string, name: string) => ({ type: "toolCall", id, name });
  const { chat, frames, submitted } = fakeChat([
    progress([assistant(1, [tool("a", "work_code")])]),
    progress([assistant(1, [tool("a", "work_code")]), assistant(2, [tool("b", "work_code"), tool("c", "ask_user")])]),
    progress([assistant(1, [tool("a", "work_code")]), assistant(2, [tool("b", "work_code"), tool("c", "ask_user")])], { role: "assistant", content: [{ type: "text", text: "First done. Second is" }] }),
    progress([assistant(1, [tool("a", "work_code")]), assistant(2, [tool("b", "work_code"), tool("c", "ask_user")]), assistant(3, [{ type: "text", text: "First done. Second is here. Third hidden." }])]),
  ]);
  const ai = { async run() { return { answers: {} }; } };
  let clock = 0;
  const out: string[] = [];
  for await (const line of runLayeredVoiceTurn({ layers: ["clef-flash"], transcript: "do it", chat, ai, now: () => (clock += 10), sleep: async () => undefined })) out.push(line);
  assert.deepEqual(submitted, ["do it"]);
  assert.ok(out[0].length > 0);
  assert.equal(out.filter((line) => line.toLowerCase().includes("code")).length, 1);
  assert.equal(out.filter((line) => line === VOICE_APPROVAL_LINE).length, 1);
  assert.deepEqual(out.slice(-2), ["First done.", "Second is here."]);
  const metrics = JSON.parse(frames[0]);
  assert.equal(metrics.kind, "metrics");
  assert.deepEqual(metrics.metrics.layers, ["clef-flash"]);
  for (const key of ["firstResponseMs", "firstReasoningMs", "approvalMs", "finishMs"]) assert.equal(typeof metrics.metrics[key], "number", key);
});

test("voice agent keeps the legacy path when no layers are set", () => {
  const source = readFileSync(new URL("./voice-think-agent.ts", import.meta.url), "utf8");
  assert.ok(source.includes("if (layers.length > 0)"));
  assert.ok(source.includes("WORK_ACK"));
});
