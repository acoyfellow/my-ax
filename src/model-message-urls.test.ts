import assert from "node:assert/strict";
import test from "node:test";
import type { ModelMessage } from "ai";
import { sanitizeModelMessageUrls } from "./model-message-urls";

test("drops relative file urls that convertToModelMessages would throw on", () => {
  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: "see this" },
        { type: "file", url: "/api/uploads/abc", mediaType: "image/png" },
      ],
    },
  ] as ModelMessage[];
  const next = sanitizeModelMessageUrls(messages);
  assert.deepEqual(next[0]?.content, [{ type: "text", text: "see this" }]);
});

test("keeps https file urls and text-only messages", () => {
  const messages = [
    { role: "user", content: "plain" },
    {
      role: "user",
      content: [{ type: "file", url: "https://example.test/a.png", mediaType: "image/png" }],
    },
  ] as ModelMessage[];
  assert.equal(sanitizeModelMessageUrls(messages)[0], messages[0]);
  assert.deepEqual(
    sanitizeModelMessageUrls(messages)[1]?.content,
    [{ type: "file", url: "https://example.test/a.png", mediaType: "image/png" }],
  );
});

test("drops junk image data that is not a data image", () => {
  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: "see this" },
        { type: "image", data: "not-an-image", mediaType: "image/png" },
      ],
    },
  ] as ModelMessage[];
  assert.deepEqual(sanitizeModelMessageUrls(messages)[0]?.content, [{ type: "text", text: "see this" }]);
});

test("a junk url string does not throw Invalid URL string", () => {
  const messages = [
    {
      role: "user",
      content: [{ type: "file", url: "not a url", mediaType: "image/png" }],
    },
  ] as unknown as ModelMessage[];
  assert.doesNotThrow(() => sanitizeModelMessageUrls(messages));
  assert.deepEqual(sanitizeModelMessageUrls(messages)[0]?.content, []);
});
