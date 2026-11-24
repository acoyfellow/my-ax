import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeLayerIds,
  FALLBACK_LAYER_OPENER,
  formatTurnLayerMetrics,
  MAX_MODEL_LAYERS,
  sanitizeLayerIds,
  sanitizeModelLayersConfig,
  sanitizeOpenerText,
} from "../model-layers";
import { LayerTurnController, runFrontLayerOpener, type LayerAiBinding, type LayerFrame } from "./model-layers-runner";

test("layer config clamps count to 0..3, heals invalid ids, and leaves 0 layers as an empty list", () => {
  assert.deepEqual(activeLayerIds(sanitizeModelLayersConfig(null)), []);
  const clamped = sanitizeModelLayersConfig({ count: 9, layers: ["clef-flash", "bogus", "llama-3.1-8b"], showMetrics: true });
  assert.equal(clamped.count, MAX_MODEL_LAYERS);
  assert.equal(clamped.layers[0], "clef-flash");
  assert.equal(clamped.layers[1], "clairic-flash");
  assert.equal(clamped.layers[2], "llama-3.1-8b");
  assert.equal(clamped.showMetrics, true);
  assert.deepEqual(sanitizeLayerIds(["fixed", "bad", "clef-flash", "clef", "llama-3.1-8b"]), ["fixed", "clef-flash", "clef"]);
});

test("opener sanitizer strips leaked think tags and enforces short single-line output", () => {
  assert.equal(sanitizeOpenerText("<think>plan</think>\nChecking your sidebar now.\nMore text"), "Checking your sidebar now.");
  assert.equal(sanitizeOpenerText("</think>Looking at it now."), "Looking at it now.");
  assert.equal(sanitizeOpenerText("one two three four five six seven eight nine ten"), "one two three four five six seven eight.");
  assert.equal(sanitizeOpenerText("   "), "");
});

test("fixed, clef, clairic, chat adapters and hard deadline fallback work cleanly", async () => {
  let called = 0;
  const fixedRes = await runFrontLayerOpener({ run: async () => { called++; return {}; } }, "fixed", "hi");
  assert.equal(called, 0);
  assert.equal(fixedRes.fellBack, false);
  assert.equal(fixedRes.text, "On it, looking now.");

  const seen: Array<{ model: string; input: Record<string, unknown> }> = [];
  const ai: LayerAiBinding = {
    async run(model, input) {
      seen.push({ model, input });
      if (model.includes("clef")) return { answers: { topic: { choice: "files" } } };
      if (model.includes("clairic")) return { answers: { action: { value: "Checking" }, thing: { value: "your sidebar" } } };
      if (model.includes("inkling")) return { response: "</think>Checking your repo now." };
      return { response: "" };
    },
  };

  const clefRes = await runFrontLayerOpener(ai, "clef-flash", "read src/ui/Sessions.svelte");
  assert.equal(clefRes.text, "Checking your files now.");
  assert.equal(clefRes.fellBack, false);
  assert.equal((seen[0].input.questions as { topic: { type: string } }).topic.type, "choice");

  const clairicRes = await runFrontLayerOpener(ai, "clairic-flash", "check my sidebar");
  assert.equal(clairicRes.text, "Checking your sidebar now.");
  assert.equal((seen[1].input.fields as { action: { type: string } }).action.type, "enum");

  const inklingRes = await runFrontLayerOpener(ai, "inkling-2-small", "check repo");
  assert.equal(inklingRes.text, "Checking your repo now.");
  assert.equal(seen[2].input.reasoning_effort, "none");
  assert.equal(seen[2].input.max_tokens, 400);

  const slowAi: LayerAiBinding = { run: () => new Promise(() => {}) };
  const timedOut = await runFrontLayerOpener(slowAi, "llama-3.1-8b", "slow", { deadlineMs: 25 });
  assert.equal(timedOut.text, FALLBACK_LAYER_OPENER);
  assert.equal(timedOut.fellBack, true);
});

test("LayerTurnController runs 2 front layers, narrates tools, passes approvals untouched, and emits 4 metrics", async () => {
  let now = 1_000;
  const frames: LayerFrame[] = [];
  const controller = new LayerTurnController("op-1", ["fixed", "clairic-flash"], { now: () => now, statusGapMs: 2_000 });
  const ai: LayerAiBinding = {
    async run() {
      await new Promise((resolve) => setTimeout(resolve, 1));
      now += 180;
      return { answers: { action: { value: "Checking" }, thing: { value: "your files" } } };
    },
  };

  await controller.start(ai, "check my files", (f) => frames.push(f));
  assert.equal(frames.filter((f) => f.kind === "opener").length, 2);
  assert.equal(frames[0].kind === "opener" && frames[0].layerIndex, 1);
  assert.equal(frames[1].kind === "opener" && frames[1].layerIndex, 2);
  assert.equal(frames[1].kind === "opener" && frames[1].text, "Checking your files now.");

  now = 2_400;
  controller.onViewEvents([{
    type: "entry_appended",
    entry: { id: 1, kind: "pi.assistant", model: [{ role: "assistant", content: [{ type: "toolCall", id: "t1", name: "work_search", arguments: {} }] }] },
  }], (f) => frames.push(f));
  const toolFrame = frames.at(-1);
  assert.equal(toolFrame?.kind, "status");
  if (toolFrame?.kind === "status") assert.equal(toolFrame.text, "Searching the codebase.");

  now = 5_200;
  controller.onViewEvents([{
    type: "entry_appended",
    entry: { id: 2, kind: "pi.assistant", model: [{ role: "assistant", content: [{ type: "toolCall", id: "t2", name: "ask_user", arguments: { question: "Deploy?" } }] }] },
  }], (f) => frames.push(f));
  const approvalFrame = frames.at(-1);
  assert.equal(approvalFrame?.kind, "status");
  assert.equal(approvalFrame?.kind === "status" && approvalFrame.approval, true);

  now = 9_500;
  const ended = controller.onViewEvents([{ type: "run_end" }], (f) => frames.push(f));
  assert.equal(ended, true);
  const metricFrame = frames.at(-1);
  assert.equal(metricFrame?.kind, "metrics");
  if (metricFrame?.kind === "metrics") {
    assert.equal(metricFrame.metrics.firstResponseMs, 0);
    assert.equal(metricFrame.metrics.firstReasoningMs, 1_400);
    assert.equal(metricFrame.metrics.approvalMs, 4_200);
    assert.equal(metricFrame.metrics.finishMs, 8_500);
    assert.equal(formatTurnLayerMetrics(metricFrame.metrics), "layers 2 · first 0.00s · reasoning 1.40s · approval 4.20s · finish 8.50s");
  }
});

test("front layers stay silent once the worker has already started answering", async () => {
  const frames: LayerFrame[] = [];
  const controller = new LayerTurnController("op-2", ["clef-flash"]);
  let release!: (value: unknown) => void;
  const ai: LayerAiBinding = { run: () => new Promise((resolve) => { release = resolve; }) };
  const running = controller.start(ai, "hi", (f) => frames.push(f));
  controller.onViewEvents([{ type: "message_update", changes: [{ type: "text_delta", contentIndex: 0, delta: "Hello" }] }], (f) => frames.push(f));
  release({ answers: { topic: { choice: "files" } } });
  await running;
  assert.equal(frames.length, 0);
});
