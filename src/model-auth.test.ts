import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gatewayAuthenticationFailure } from "./model-auth";

describe("gateway authentication recovery", () => {
  it("recognizes provider authentication failures", () => {
    assert.equal(gatewayAuthenticationFailure(new Error("Unauthorized")).failed, true);
    assert.equal(gatewayAuthenticationFailure({ statusCode: 401, responseBody: "{}" }).failed, true);
    assert.equal(gatewayAuthenticationFailure('{"error":{"message":"Unauthenticated"}}').failed, true);
  });

  it("does not classify unrelated model failures as authentication", () => {
    assert.equal(gatewayAuthenticationFailure(new Error("Rate limit exceeded")).failed, false);
    assert.equal(gatewayAuthenticationFailure({ statusCode: 429 }).failed, false);
  });
});
