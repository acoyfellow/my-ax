import assert from "node:assert/strict";
import test from "node:test";
import { isTransientRateLimit } from "./upstream-rate-limit";

test("classifies gateway 3021 / rate-limit / overloaded as transient", () => {
  assert.equal(isTransientRateLimit("3021: rate limiting: inference request per min rate reached"), true);
  assert.equal(isTransientRateLimit("HTTP 429 Too Many Requests"), true);
  assert.equal(isTransientRateLimit("model overloaded, please retry"), true);
  assert.equal(isTransientRateLimit("rate_limit exceeded"), true);
  assert.equal(isTransientRateLimit(new Error("inference request per min rate reached")), true);
});

test("does not classify ordinary failures as transient rate limits", () => {
  assert.equal(isTransientRateLimit("TypeError: cannot read property of undefined"), false);
  assert.equal(isTransientRateLimit("session not found or not owned"), false);
  assert.equal(isTransientRateLimit(""), false);
  assert.equal(isTransientRateLimit(null), false);
  assert.equal(isTransientRateLimit(undefined), false);
});

test("word boundaries: substrings that merely contain 'rate limit'/'overloaded' are not transient", () => {
  assert.equal(isTransientRateLimit("validation failed: prorate_limit must be positive"), false);
  assert.equal(isTransientRateLimit("field overloadedFlag is invalid"), false);
  // Documented genuine forms still classify as transient.
  assert.equal(isTransientRateLimit("rate_limit exceeded"), true);
  assert.equal(isTransientRateLimit("model overloaded"), true);
});
