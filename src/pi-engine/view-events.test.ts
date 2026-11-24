import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { createRegistry, defineExtension, defineTool, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { obj, str } from "@earendil-works/pi-schema";
import { PiTranscript, type PiEntry } from "../ui/pi-transcript";
import { isCompacting, runFailureText, viewEvents, type ViewEvent, type WatchedView } from "./view-events";

async function run(responses: Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0]) {
  const context = BACKGROUND_CONTEXT;
  const faux = fauxProvider({ tokensPerSecond: 8, tokenSize: { min: 4, max: 4 } });
  faux.setResponses(responses);
  const models = createModels();
  models.setProvider(faux.provider);
  const registry = createRegistry();
  registry.install(defineExtension({ name: "test.echo", tools: [defineTool({ name: "echo", description: "Echo", parameters: obj({ text: str() }), execute: async (args) => ({ output: [{ type: "text", text: `echo:${args.text}` }] }) })] }));
  const harness = await Harness.open(new MemoryStorage(), { models, registry }, context);
  const model = faux.getModel();
  const root = await harness.root(context, { agent: { model: { provider: model.provider, modelId: model.id } } });
  const watch = await root.watch(context);
  let previous = watch.value as unknown as WatchedView;
  const transcript = new PiTranscript();
  const events: ViewEvent[] = [];
  const streamedTexts: string[] = [];
  watch.start(async (call) => {
    if (call.kind !== "value") return;
    const next = call.value as unknown as WatchedView;
    const batch = viewEvents(previous, next, call.ops);
    previous = next;
    events.push(...batch);
    transcript.applyEvents(batch);
    const streaming = transcript.messages().find((message) => message.streaming);
    const text = streaming?.parts.filter((part) => part.kind === "text").map((part) => (part as { text: string }).text).join("");
    if (text) streamedTexts.push(text);
  });
  const submission = await root.submit({ type: "input", content: "hi" }, context);
  await submission.wait(context);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const entries = (await root.context(context)).entries as unknown as PiEntry[];
  await watch.stop();
  await harness.close(context);
  return { events, transcript, entries, streamedTexts };
}

test("watch changes become the browser's events and rebuild the same transcript", async () => {
  const answer = "The quick brown fox jumps over the lazy dog, then naps.";
  const { events, transcript, entries, streamedTexts } = await run([
    fauxAssistantMessage([fauxToolCall("echo", { text: "x" })], { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxText(answer)]),
  ]);
  const types = events.map((event) => event.type);
  assert.equal(types[0], "run_start");
  assert.equal(types.at(-1), "run_end");
  assert.ok(types.filter((type) => type === "entry_appended").length >= 4);
  const deltas = events.flatMap((event) => (event.type === "message_update" ? (event.changes as Array<{ type: string }>) : [])).filter((change) => change.type === "text_delta");
  assert.ok(deltas.length > 0, "streamed text is sent as deltas, not whole messages");
  assert.ok(streamedTexts.some((text) => text.length > 0 && text.length < answer.length), "the browser saw a partial answer");
  const fromServer = new PiTranscript();
  fromServer.applySnapshot({ busy: false, model: "", entries, partial: null, tools: [], queued: 0 });
  assert.deepEqual(transcript.messages().map(({ timestamp, endedAt, ...rest }) => rest), fromServer.messages().map(({ timestamp, endedAt, ...rest }) => rest));
  assert.equal(transcript.busy, false);
  const finalText = transcript.messages().at(-1)?.parts.filter((part) => part.kind === "text").map((part) => (part as { text: string }).text).join("");
  assert.equal(finalText, answer);
  const tool = transcript.messages().flatMap((message) => message.parts).find((part) => part.kind === "tool");
  assert.equal((tool as { tool: { result?: string } } | undefined)?.tool.result, "echo:x");
});

test("a failed model call shows as an error message", async () => {
  const { transcript } = await run([fauxAssistantMessage([], { stopReason: "error", errorMessage: "provider exploded" })]);
  const last = transcript.messages().at(-1);
  assert.equal(last?.role, "error");
  assert.match(last?.content ?? "", /provider exploded/);
});

test("aborts and resets are not shown as errors; turn limits are", () => {
  assert.equal(runFailureText({ reason: "aborted" }), null);
  assert.equal(runFailureText({ reason: "reset" }), null);
  assert.equal(runFailureText({ reason: "nothing_to_answer" }), null);
  assert.equal(runFailureText({ reason: "turn_limit", detail: "3 turns" }), "Stopped after 3 turns.");
  assert.equal(runFailureText({ reason: "model_error", detail: "rate limited" }), "rate limited");
});

test("stop during a hanging tool ends the run and the browser goes idle", async () => {
  const context = BACKGROUND_CONTEXT;
  const faux = fauxProvider();
  faux.setResponses([fauxAssistantMessage([fauxToolCall("hang", {})], { stopReason: "toolUse" })]);
  const models = createModels();
  models.setProvider(faux.provider);
  const registry = createRegistry();
  let started!: () => void;
  const toolStarted = new Promise<void>((resolve) => { started = resolve; });
  registry.install(defineExtension({ name: "test.hang", tools: [defineTool({ name: "hang", description: "Never ends", parameters: obj({}), execute: (_args, _api, ctx) => { started(); return new Promise((_, reject) => ctx.abortSignal?.addEventListener("abort", () => reject(new Error("aborted")))); } })] }));
  const harness = await Harness.open(new MemoryStorage(), { models, registry }, context);
  const model = faux.getModel();
  const root = await harness.root(context, { agent: { model: { provider: model.provider, modelId: model.id } } });
  const watch = await root.watch(context);
  let previous = watch.value as unknown as WatchedView;
  const transcript = new PiTranscript();
  watch.start(async (call) => {
    if (call.kind !== "value") return;
    const next = call.value as unknown as WatchedView;
    transcript.applyEvents(viewEvents(previous, next, call.ops));
    previous = next;
  });
  await root.submit({ type: "input", content: "hang" }, context);
  await toolStarted;
  assert.equal(transcript.busy, true);
  await root.abort(context);
  await root.waitForIdle(context);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(transcript.busy, false);
  assert.notEqual(transcript.messages().at(-1)?.role, "error");
  await watch.stop();
  await harness.close(context);
});

test("blocking compaction emits compaction_start and compaction_end so the UI does not sit silent", () => {
  const idle: WatchedView = { entries: [], docs: { "pi.live": { run: { taskId: 1 } } } };
  const compacting: WatchedView = { entries: [], docs: { "pi.live": { run: { taskId: 1 }, compactions: [{ taskId: 2, reason: "threshold", blocking: true }] } } };
  const done: WatchedView = { entries: [{ id: 10, kind: "pi.compaction" }], docs: { "pi.live": { run: { taskId: 1 } } } };
  const aborted: WatchedView = { entries: [], docs: { "pi.live": { run: { taskId: 1 } } } };

  assert.equal(isCompacting(idle), false);
  assert.equal(isCompacting(compacting), true);
  assert.deepEqual(viewEvents(idle, compacting), [{ type: "compaction_start" }]);
  assert.deepEqual(viewEvents(compacting, done), [{ type: "entry_appended", entry: { id: 10, kind: "pi.compaction" } }, { type: "compaction_end" }]);
  assert.deepEqual(viewEvents(compacting, aborted), [{ type: "compaction_end", error: "aborted" }]);
});

test("PiChatAgent answers both pi_ping and my_ax_ping so slow model turns never drop the socket", () => {
  const agent = readFileSync(new URL("./pi-chat-agent.ts", import.meta.url), "utf8");
  const chat = readFileSync(new URL("../ui/Chat.svelte", import.meta.url), "utf8");
  assert.match(agent, /frame\.type === "pi_ping"/);
  assert.match(agent, /frame\.type === "my_ax_ping"/);
  assert.match(chat, /piTranscript \? \{ type: "pi_ping"/);
});
