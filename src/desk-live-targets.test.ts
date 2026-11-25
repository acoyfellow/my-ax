import assert from "node:assert/strict";
import { test } from "node:test";
import { FAST_ROUTED_MODEL_ID } from "./model-layers";
import { runClefJointRouter, type LayerAiBinding } from "./pi-engine/model-layers-runner";
import { filterLiveDeskTargets, LIVE_CHAT_TTL_MS } from "./desk-live";

test("filterLiveDeskTargets wakes only chats with a live socket inside the TTL window", () => {
  const now = 10_000_000;
  const live = new Map<string, number>([
    ["chat-live", now - 5_000],
    ["chat-stale", now - LIVE_CHAT_TTL_MS - 1],
  ]);
  const targets = filterLiveDeskTargets(["chat-sleeping-1", "chat-live", "chat-stale", "chat-live", "chat-sleeping-2"], live, now);
  assert.deepEqual(targets, ["chat-live"]);
  assert.deepEqual(filterLiveDeskTargets(["chat-sleeping-1"], live, now), []);
});

test("runClefJointRouter reads Clef wire-level noul probability to fast-route trivial prompts", async () => {
  const ai: LayerAiBinding = {
    async run(_model, input) {
      const state = String(input.state ?? "");
      if (state.includes("17 * 23")) {
        return { answers: { topic: { type: "choice", choice: "other" }, needs_worker: { type: "noul", noul: 0.08 } } };
      }
      return { answers: { topic: { type: "choice", choice: "computer" }, needs_worker: { type: "noul", noul: 0.92 } } };
    },
  };
  const fast = await runClefJointRouter(ai, "What is 17 * 23?", "gemini-4-neon", false);
  assert.equal(fast.route, "fast");
  assert.equal(fast.targetModel, FAST_ROUTED_MODEL_ID);
  assert.equal(fast.reaction, "⚡");

  const deep = await runClefJointRouter(ai, "Run uname -s", "gemini-4-neon", false);
  assert.equal(deep.route, "worker");
  assert.equal(deep.targetModel, "gemini-4-neon");
  assert.equal(deep.reaction, "💻");
});
