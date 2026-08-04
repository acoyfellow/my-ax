import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gatewayConfig } from "./llm";
import type { Env } from "./types";

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
