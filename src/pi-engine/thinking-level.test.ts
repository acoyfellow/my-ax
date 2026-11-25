import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai";
import { createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { sanitizeThinkingLevel } from "./thinking-level";

test("sanitizeThinkingLevel accepts only low, medium, high", () => {
  assert.equal(sanitizeThinkingLevel("low"), "low");
  assert.equal(sanitizeThinkingLevel("medium"), "medium");
  assert.equal(sanitizeThinkingLevel("high"), "high");
  assert.equal(sanitizeThinkingLevel("max"), undefined);
  assert.equal(sanitizeThinkingLevel(undefined), undefined);
  assert.equal(sanitizeThinkingLevel(3), undefined);
});

test("a real Harness conversation stores configured thinkingLevel", async () => {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const harness = await Harness.open(new MemoryStorage(), { models, registry: createRegistry() }, BACKGROUND_CONTEXT);
  const model = faux.getModel();
  const root = await harness.root(BACKGROUND_CONTEXT, { agent: { model: { provider: model.provider, modelId: model.id } } });
  await root.configure({ thinkingLevel: "high" }, BACKGROUND_CONTEXT);
  const reopened = await harness.root(BACKGROUND_CONTEXT);
  await reopened.configure({ thinkingLevel: "low" }, BACKGROUND_CONTEXT);
  await harness.close(BACKGROUND_CONTEXT);
});

test("Chat.svelte sends reasoning on pi_submit and the agent applies it", () => {
  const chat = readFileSync("src/ui/Chat.svelte", "utf8");
  assert.match(chat, /reasoning: modelState\.reasoning, model: modelState\.current \}/);
  const agent = readFileSync("src/pi-engine/pi-chat-agent.ts", "utf8");
  assert.match(agent, /applyThinkingLevel\(sanitizeThinkingLevel\(frame\.reasoning\)\)/);
});
