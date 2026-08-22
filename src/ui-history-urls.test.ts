import assert from "node:assert/strict";
import test from "node:test";
import { healUiHistoryFileUrls, rewriteFileUrl } from "./ui-history-urls";

test("relative upload urls become absolute https urls", () => {
  const messages = [{ parts: [{ type: "file", url: "/api/uploads/abc", mediaType: "image/png" }] }];
  assert.equal(healUiHistoryFileUrls(messages, "https://my.example"), 1);
  assert.equal(messages[0]?.parts?.[0]?.url, "https://my.example/api/uploads/abc");
  assert.doesNotThrow(() => new URL(String(messages[0]?.parts?.[0]?.url)));
});

test("a relative url is dropped when no origin is available", () => {
  const messages = [{ parts: [{ type: "file", url: "/api/uploads/abc", mediaType: "image/png" }, { type: "text", text: "ok" }] }];
  assert.equal(healUiHistoryFileUrls(messages, ""), 1, "the heal must run even with no origin");
  assert.deepEqual(
    messages[0]?.parts,
    [{ type: "text", text: "ok" }],
    "an unusable relative url must never reach the AI SDK",
  );
});

test("an absolute url survives when no origin is available", () => {
  const messages = [{ parts: [{ type: "file", url: "https://my.example/api/uploads/abc", mediaType: "image/png" }] }];
  healUiHistoryFileUrls(messages, "");
  assert.equal(messages[0]?.parts?.[0]?.url, "https://my.example/api/uploads/abc");
});

test("every surviving image url parses with no base", () => {
  const messages = [{
    parts: [
      { type: "file", url: "/api/uploads/relative", mediaType: "image/png" },
      { type: "file", url: "https://my.example/ok.png", mediaType: "image/png" },
      { type: "image", data: "not-an-image", mediaType: "image/png" },
    ],
  }];
  healUiHistoryFileUrls(messages, "");
  for (const part of messages[0]!.parts!) {
    if (typeof part.url !== "string") continue;
    assert.doesNotThrow(() => new URL(String(part.url)), `survivor must parse: ${String(part.url)}`);
  }
});

test("rewriteFileUrl accepts upload paths", () => {
  assert.equal(rewriteFileUrl("/api/uploads/abc", "https://my.example"), "https://my.example/api/uploads/abc");
});

test("heal drops junk image data that is not a data image", () => {
  const messages = [{ parts: [{ type: "image", data: "not-an-image", mediaType: "image/png" }, { type: "text", text: "ok" }] }];
  assert.equal(healUiHistoryFileUrls(messages, "https://my.example"), 1);
  assert.deepEqual(messages[0]?.parts, [{ type: "text", text: "ok" }]);
});
