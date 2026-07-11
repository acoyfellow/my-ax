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
