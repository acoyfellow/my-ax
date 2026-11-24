import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FALLBACK_LAYER_OPENER,
  FAST_ROUTED_MODEL_ID,
  findModelLayerOption,
  isSafeOpenerText,
  reactionForTool,
  VERIFIED_LAYER_OPTIONS,
} from "../model-layers";
import { runClefJointRouter, runFrontLayerOpener, type LayerAiBinding } from "./model-layers-runner";

test("verified dropdown catalog prunes the five 100%-timeout models and includes Clef Flash Router", () => {
  const verifiedIds = new Set(VERIFIED_LAYER_OPTIONS.map((opt) => opt.id));
  for (const dropped of ["gemma-4-26b", "granite-4-micro", "inkling-2-small", "deepseek-v4.1-flash", "gpt-oss-20b"]) {
    assert.equal(verifiedIds.has(dropped), false, `${dropped} should not appear in verified dropdown`);
  }
  assert.equal(findModelLayerOption("clef-router")?.kind, "clef-router");
  assert.equal(verifiedIds.has("clef-router"), true);
  assert.ok(VERIFIED_LAYER_OPTIONS.every((opt) => opt.p50Ms <= 500));
});

test("past-tense and fact-leak guard blocks hallucinated completion lines like PhoneLLM's", async () => {
  assert.equal(isSafeOpenerText("Just executed the command, now replying."), false);
  assert.equal(isSafeOpenerText("Found 42 zones in your account."), false);
  assert.equal(isSafeOpenerText("Already fixed the bug."), false);
  assert.equal(isSafeOpenerText("Checking your files now."), true);
  assert.equal(isSafeOpenerText("Scanning your workspace for TODOs right now."), true);

  const lyingAi: LayerAiBinding = {
    async run() {
      return { response: "Just executed the command, now replying." };
    },
  };
  const guarded = await runFrontLayerOpener(lyingAi, "phonellm-mini", "run uname");
  assert.equal(guarded.text, FALLBACK_LAYER_OPENER);
  assert.equal(guarded.fellBack, true);
});

test("joint Clef router answers topic + fast/worker route in one single call", async () => {
  let calls = 0;
  const ai: LayerAiBinding = {
    async run(_model, input) {
      calls++;
      const state = String(input.state ?? "");
      if (state.includes("2+2")) return { answers: { topic: { choice: "other" }, needs_worker: { value: false } } };
      return { answers: { topic: { choice: "computer" }, needs_worker: { value: true } } };
    },
  };

  const trivial = await runClefJointRouter(ai, "What is 2+2?", "gemini-4-neon", false);
  assert.equal(calls, 1);
  assert.equal(trivial.route, "fast");
  assert.equal(trivial.targetModel, FAST_ROUTED_MODEL_ID);
  assert.equal(trivial.reaction, "⚡");

  const withImage = await runClefJointRouter(ai, "What is 2+2?", "gemini-4-neon", true);
  assert.equal(withImage.route, "worker");
  assert.equal(withImage.targetModel, "gemini-4-neon");

  const shell = await runClefJointRouter(ai, "Run uname -s on my machine", "gemini-4-neon", false);
  assert.equal(shell.route, "worker");
  assert.equal(shell.targetModel, "gemini-4-neon");
  assert.equal(shell.reaction, "💻");
  assert.equal(reactionForTool("ask_user"), "✋");
  assert.equal(reactionForTool("exec"), "💻");
});
