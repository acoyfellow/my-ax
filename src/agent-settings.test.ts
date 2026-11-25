import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { combineInstructions, defaultAgentSettings, resolveEffectiveSettings, sanitizeAgentSettings } from "./agent-settings";
import { PI_ENGINE_MODEL_CHOICES } from "./pi-engine/gateway-models";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("defaults inherit everything", () => {
  assert.deepEqual(defaultAgentSettings(), { model: null, reasoning: null, layers: null, instructions: null });
});

test("sanitize drops invalid values and keeps valid ones", () => {
  const modelId = PI_ENGINE_MODEL_CHOICES[0]!.id;
  const clean = sanitizeAgentSettings({ model: modelId, reasoning: "high", layers: ["llama-3.1-8b", "nope"], instructions: "  be brief  " });
  assert.equal(clean.model, modelId);
  assert.equal(clean.reasoning, "high");
  assert.deepEqual(clean.layers, ["llama-3.1-8b"]);
  assert.equal(clean.instructions, "be brief");
  assert.deepEqual(sanitizeAgentSettings({ model: "bogus", reasoning: "max", layers: "x", instructions: "x".repeat(4001) }), defaultAgentSettings());
  assert.deepEqual(sanitizeAgentSettings(null), defaultAgentSettings());
});

test("empty layers array is an explicit off override", () => {
  assert.deepEqual(sanitizeAgentSettings({ layers: [] }).layers, []);
});

test("resolve prefers agent settings over global", () => {
  const modelId = PI_ENGINE_MODEL_CHOICES[0]!.id;
  const effective = resolveEffectiveSettings(sanitizeAgentSettings({ model: modelId, reasoning: "low" }), { model: "other", reasoning: "high", layers: ["llama-3.1-8b"] });
  assert.equal(effective.model, modelId);
  assert.equal(effective.reasoning, "low");
  assert.deepEqual(effective.layers, ["llama-3.1-8b"]);
  assert.equal(effective.hasOverrides, true);
});

test("layers [] overrides global while null inherits it", () => {
  const global = { layers: ["llama-3.1-8b"] };
  assert.deepEqual(resolveEffectiveSettings(sanitizeAgentSettings({ layers: [] }), global).layers, []);
  assert.deepEqual(resolveEffectiveSettings(defaultAgentSettings(), global).layers, ["llama-3.1-8b"]);
  assert.equal(resolveEffectiveSettings(defaultAgentSettings(), global).hasOverrides, false);
});

test("agent instructions append to owner instructions", () => {
  assert.equal(combineInstructions("owner", defaultAgentSettings()), "owner");
  assert.equal(combineInstructions("owner", sanitizeAgentSettings({ instructions: "x" })), "owner\n\nAgent-specific instructions:\nx");
});

test("session routes expose owner-checked agent-settings", () => {
  const source = read("./routes/sessions.ts");
  assert.match(source, /app\.get\("\/api\/sessions\/:id\/agent-settings"/);
  assert.match(source, /app\.put\("\/api\/sessions\/:id\/agent-settings"/);
  assert.match(source, /setAgentSettings\(body\)/);
});

test("agent persists settings in DO kv and enforces them on submit", () => {
  const source = read("./pi-engine/pi-chat-agent.ts");
  assert.match(source, /"agent-settings"/);
  assert.match(source, /resolveEffectiveSettings\(this\.readAgentSettings\(\)/);
  assert.match(source, /async getAgentSettings/);
  assert.match(source, /async setAgentSettings/);
});

test("modal is wired into Sessions and Chat", () => {
  const modal = read("./ui/AgentSettingsModal.svelte");
  assert.match(modal, /my-ax:agent-settings-open/);
  assert.match(modal, /Use global default/);
  assert.match(modal, /Reset all to defaults/);
  assert.match(read("./ui/Sessions.svelte"), /Agent settings…/);
  const chat = read("./ui/Chat.svelte");
  assert.match(chat, /<AgentSettingsModal \/>/);
  assert.match(chat, /model: modelState\.current \}\)\);/);
});
