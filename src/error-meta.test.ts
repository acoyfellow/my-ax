import test from "node:test";
import assert from "node:assert/strict";
import { errorConversationMeta } from "./error-meta";

test("errorConversationMeta preserves Error diagnostic fields", () => {
  const cause = new TypeError("bad base URL");
  const error = new Error("Invalid URL string.", { cause });
  error.stack = "Error: Invalid URL string.\n    at buildUrl (agent.ts:1:1)";

  const meta = errorConversationMeta(error);

  assert.equal(meta.errorName, "Error");
  assert.equal(meta.errorMessage, "Invalid URL string.");
  assert.match(String(meta.errorStack), /buildUrl/);
  assert.deepEqual(meta.errorCause, {
    name: "TypeError",
    message: "bad base URL",
    stack: cause.stack,
  });
});

test("errorConversationMeta handles non-Error throws", () => {
  assert.deepEqual(errorConversationMeta("boom"), {
    errorName: "string",
    errorMessage: "boom",
  });
});

test("errorConversationMeta survives an unserializable thrown value", () => {
  const thrown = Object.create(null);
  assert.deepEqual(errorConversationMeta(thrown), {
    errorName: "object",
    errorMessage: "[unserializable thrown value]",
  });
  const cause = Object.create(null);
  cause.self = cause;
  assert.equal(errorConversationMeta(new Error("boom", { cause })).errorCause, "[unserializable error cause]");
});

test("a revoked proxy is classified as a non-Error value, not re-thrown", () => {
  const top = Proxy.revocable({}, {});
  top.revoke();
  assert.deepEqual(errorConversationMeta(top.proxy), {
    errorName: "object",
    errorMessage: "[unserializable thrown value]",
  });
  const nested = Proxy.revocable({}, {});
  nested.revoke();
  assert.equal(
    errorConversationMeta(new Error("boom", { cause: nested.proxy })).errorCause,
    "[unserializable error cause]",
  );
});

test("a throwing stack accessor does not escape the reporter", () => {
  const error = new Error("boom");
  Object.defineProperty(error, "stack", { get() { throw new Error("stack trap"); } });
  assert.deepEqual(errorConversationMeta(error), { errorName: "Error", errorMessage: "boom" });
  const cause = new Error("inner");
  Object.defineProperty(cause, "stack", { get() { throw new Error("cause stack trap"); } });
  assert.deepEqual(
    errorConversationMeta(new Error("outer", { cause })).errorCause,
    { name: "Error", message: "inner" },
  );
});
