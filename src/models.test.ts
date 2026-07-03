import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { availableModels, DEFAULT_MODEL_ID, MODELS, findModel, resolveAvailableModelId, resolveModelId } from "./models";
import type { Env } from "./types";

const minimalEnv = {} as Env;
const gatewayEnv = { LLM_GATEWAY_URL: "https://gateway.example/openai", LLM_GATEWAY_TOKEN: "token" } as Env;

describe("model catalog", () => {
  it("keeps Workers AI and AI Gateway rows in the full catalog", () => {
    assert.ok(findModel("@cf/moonshotai/kimi-k2.7-code"));
    assert.ok(findModel("@cf/zai-org/glm-5.2"));
    assert.equal(findModel("gpt-5.5")?.route, "gateway-openai");
    assert.equal(findModel("gpt-5.6-luna")?.route, "gateway-openai");
    assert.equal(findModel("gpt-5.6-sol")?.route, "gateway-openai");
    assert.equal(findModel("gpt-5.6-terra")?.route, "gateway-openai");
    assert.equal(findModel("claude-opus-4-8")?.route, "gateway-anthropic");
    for (const model of MODELS) assert.equal(model.tools, true, model.id);
  });

  it("shows gateway rows only when the installation has gateway config", () => {
    assert.deepEqual(availableModels(minimalEnv).map((m) => m.id), ["@cf/moonshotai/kimi-k2.7-code", "@cf/zai-org/glm-5.2"]);
    assert.deepEqual(availableModels(gatewayEnv).map((m) => m.id), ["@cf/moonshotai/kimi-k2.7-code", "@cf/zai-org/glm-5.2", "claude-opus-4-8", "gpt-5.5", "gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"]);
  });

  it("removes alpha rows while healing stale alpha ids", () => {
    for (const model of MODELS) assert.equal(/alpha/i.test(`${model.id} ${model.label}`), false, model.id);
    assert.equal(resolveModelId("kindle-alpha-api"), DEFAULT_MODEL_ID);
    assert.equal(resolveModelId("mercury-alpha"), DEFAULT_MODEL_ID);
  });

  it("uses a visible default and preserves valid gateway ids", () => {
    assert.ok(findModel(DEFAULT_MODEL_ID));
    assert.equal(resolveModelId(undefined), DEFAULT_MODEL_ID);
    assert.equal(resolveModelId("gpt-5.5"), "gpt-5.5");
    assert.equal(resolveModelId("gpt-5.6-luna"), "gpt-5.6-luna");
    assert.equal(resolveModelId("gpt-5.6-sol"), "gpt-5.6-sol");
    assert.equal(resolveModelId("gpt-5.6-terra"), "gpt-5.6-terra");
    assert.equal(resolveModelId("claude-opus-4-8"), "claude-opus-4-8");
  });

  it("heals stale gateway selections when this installation has no gateway", () => {
    assert.equal(resolveAvailableModelId(minimalEnv, "gpt-5.5"), DEFAULT_MODEL_ID);
    assert.equal(resolveAvailableModelId(minimalEnv, "claude-opus-4-8"), DEFAULT_MODEL_ID);
    assert.equal(resolveAvailableModelId(gatewayEnv, "gpt-5.5"), "gpt-5.5");
    assert.equal(resolveAvailableModelId(gatewayEnv, "gpt-5.6-luna"), "gpt-5.6-luna");
    assert.equal(resolveAvailableModelId(gatewayEnv, "gpt-5.6-sol"), "gpt-5.6-sol");
    assert.equal(resolveAvailableModelId(gatewayEnv, "gpt-5.6-terra"), "gpt-5.6-terra");
  });
});
