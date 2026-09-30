import assert from "node:assert/strict";
import test from "node:test";
import { modelGatewayConfig } from "./llm";
import { availableModels, findModel } from "./models";
import type { Env } from "./types";

const gatewayEnv = {
  LLM_GATEWAY_URL: "https://gateway.example.com/openai",
  LLM_GATEWAY_TOKEN: "token",
  LLM_GATEWAY_AUTH_HEADER: "cf-access-token",
} as unknown as Env;

test("Kimi K3 is served through the gateway's Workers AI route", () => {
  const k3 = findModel("@cf/moonshotai/kimi-k3");
  assert.equal(k3?.route, "gateway-workers-ai");
  assert.equal(modelGatewayConfig(gatewayEnv, k3!).baseURL, "https://gateway.example.com/workers-ai/v1");
});

test("Anthropic and OpenAI routes keep their gateway paths", () => {
  assert.equal(modelGatewayConfig(gatewayEnv, findModel("claude-opus-5-5")!).baseURL, "https://gateway.example.com/anthropic");
  assert.equal(modelGatewayConfig(gatewayEnv, findModel("gpt-5.6-sol")!).baseURL, "https://gateway.example.com/openai");
});

test("gateway Workers AI models are hidden when no gateway is configured", () => {
  const ids = availableModels({} as Env).map((model) => model.id);
  assert.equal(ids.includes("@cf/moonshotai/kimi-k3"), false);
  assert.equal(ids.includes("@cf/zai-org/glm-5.3"), true);
});
