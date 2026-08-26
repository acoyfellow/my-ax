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

test("real upload bytes survive the sanitizer so a vision model sees the image", () => {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: "what is in this image" },
        { type: "file", data: bytes, mediaType: "image/png" },
      ],
    },
  ] as unknown as ModelMessage[];
  const content = sanitizeModelMessageUrls(messages)[0]?.content as Array<{ type: string; data?: unknown }>;
  assert.equal(content.length, 2);
  assert.equal(content[1]?.type, "file");
  assert.equal(content[1]?.data, bytes);
});

test("an ArrayBuffer-backed image part is not dropped", () => {
  const view = new Uint8Array(new ArrayBuffer(4));
  const messages = [
    { role: "user", content: [{ type: "image", data: view, mediaType: "image/jpeg" }] },
  ] as unknown as ModelMessage[];
  const content = sanitizeModelMessageUrls(messages)[0]?.content as unknown[];
  assert.equal(content.length, 1);
});
