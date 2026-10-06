import assert from "node:assert/strict";
import { test } from "node:test";
import { anthropicGatewayBaseUrl, gatewayRequestHeaders, PI_ENGINE_MODEL_CHOICES } from "./gateway-models";

test("gateway base url switches the openai route to the anthropic route", () => {
  assert.equal(anthropicGatewayBaseUrl("https://gw.example/v1/openai"), "https://gw.example/v1/anthropic");
  assert.equal(anthropicGatewayBaseUrl("https://gw.example/anthropic/"), "https://gw.example/anthropic");
});

test("an access-token gateway also gets an authorization header so the Anthropic SDK sends no api key", () => {
  assert.deepEqual(gatewayRequestHeaders({ "cf-access-token": "t" }), { "cf-access-token": "t", authorization: "Bearer t" });
  assert.deepEqual(gatewayRequestHeaders({ authorization: "Bearer x" }), { authorization: "Bearer x" });
});

test("Opus 5.5 is the first model choice", () => {
  assert.equal(PI_ENGINE_MODEL_CHOICES[0].id, "claude-opus-5-5");
});
