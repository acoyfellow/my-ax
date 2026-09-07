import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gatewayConfig, modelGatewayConfig, resolveMyAxModel } from "./llm";
import { findModel } from "./models";
import type { Env } from "./types";

describe("special model routing", () => {
  const env = { LLM_SPECIAL_GATEWAY_URL: "https://special.example", LLM_SPECIAL_GATEWAY_TOKEN: "special-token", LLM_GATEWAY_URL: "https://ordinary.example/openai", LLM_GATEWAY_TOKEN: "ordinary-token" } as Env;
  for (const [id, upstream, path] of [
    ["openai-special/gpt-6-astra", "gpt-6-astra", "/openai/v1"],
    ["anthropic-fable/claude-fable-5-1", "claude-fable-5-1", "/anthropic"],
  ]) {
    it(`routes ${id} through its own gateway with the exact upstream id`, () => {
      const meta = findModel(id)!;
      const config = modelGatewayConfig(env, meta);
      assert.equal(config.baseURL, `https://special.example${path}`);
      assert.equal(config.headers["cf-access-token"], "special-token");
      assert.equal(resolveMyAxModel(env, id).model.modelId, upstream);
      assert.throws(() => modelGatewayConfig({ ...env, LLM_SPECIAL_GATEWAY_TOKEN: "" }, meta), /special gateway/);
      assert.throws(() => modelGatewayConfig({ ...env, LLM_SPECIAL_GATEWAY_URL: "http://special.example" }, meta), /HTTPS origin/);
    });
  }
});

describe("gateway authentication configuration", () => {
  it("uses a configured bearer token", () => {
    const config = gatewayConfig({
      LLM_GATEWAY_URL: "https://gateway.example/openai",
      LLM_GATEWAY_TOKEN: "token",
      LLM_GATEWAY_AUTH_HEADER: "cf-access-token",
    } as Env);
    assert.equal(config.headers["cf-access-token"], "token");
  });

  it("prefers durable Access service-token headers when no bearer is configured", () => {
    const config = gatewayConfig({
      LLM_GATEWAY_URL: "https://gateway.example/openai",
      LLM_GATEWAY_SERVICE_TOKEN_ID: "service-id",
      LLM_GATEWAY_SERVICE_TOKEN_SECRET: "service-secret",
    } as Env);
    assert.equal(config.headers["CF-Access-Client-Id"], "service-id");
    assert.equal(config.headers["CF-Access-Client-Secret"], "service-secret");
    assert.equal("authorization" in config.headers, false);
  });

  it("fails closed when gateway authentication is incomplete", () => {
    assert.throws(() => gatewayConfig({ LLM_GATEWAY_URL: "https://gateway.example/openai" } as Env), /gateway authentication/);
    assert.throws(() => gatewayConfig({
      LLM_GATEWAY_URL: "https://gateway.example/openai",
      LLM_GATEWAY_SERVICE_TOKEN_ID: "service-id",
    } as Env), /gateway authentication/);
  });
});
