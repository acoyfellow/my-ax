import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { availableModels, DEFAULT_GATEWAY_MODEL_ID, DEFAULT_MODEL_ID, MODELS, defaultModelId, findModel, resolveAvailableModelId, resolveModelId } from "./models";
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
    // Gateway-less: the only runnable rows are Workers-AI, so a stale gateway id
    // heals to the Workers-AI fallback default.
    assert.equal(resolveAvailableModelId(minimalEnv, "gpt-5.5"), DEFAULT_MODEL_ID);
    assert.equal(resolveAvailableModelId(minimalEnv, "claude-opus-4-8"), DEFAULT_MODEL_ID);
    assert.equal(resolveAvailableModelId(gatewayEnv, "gpt-5.5"), "gpt-5.5");
    assert.equal(resolveAvailableModelId(gatewayEnv, "gpt-5.6-luna"), "gpt-5.6-luna");
    assert.equal(resolveAvailableModelId(gatewayEnv, "gpt-5.6-sol"), "gpt-5.6-sol");
    assert.equal(resolveAvailableModelId(gatewayEnv, "gpt-5.6-terra"), "gpt-5.6-terra");
  });

  it("prefers the resilient gateway model as the default on gateway installs", () => {
    // The gateway default routes through the AI gateway (createRetryFetch 3021
    // backoff); the Workers-AI binding default had no rate-limit self-healing.
    assert.equal(DEFAULT_GATEWAY_MODEL_ID, "gpt-5.6-terra");
    assert.equal(findModel(DEFAULT_GATEWAY_MODEL_ID)?.route, "gateway-openai");
    // Gateway present -> default is the gateway model.
    assert.equal(defaultModelId(gatewayEnv), "gpt-5.6-terra");
    // Gateway absent -> default heals back to the Workers-AI fallback (the
    // gateway model is not runnable / not in the available catalog).
    assert.equal(defaultModelId(minimalEnv), DEFAULT_MODEL_ID);
    // A fresh turn (no requested model) starts on the env-appropriate default.
    assert.equal(resolveAvailableModelId(gatewayEnv, undefined), "gpt-5.6-terra");
    assert.equal(resolveAvailableModelId(minimalEnv, undefined), DEFAULT_MODEL_ID);
  });
});
