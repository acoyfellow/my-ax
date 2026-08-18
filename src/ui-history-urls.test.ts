import assert from "node:assert/strict";
import test from "node:test";
import { healUiHistoryFileUrls, rewriteFileUrl } from "./ui-history-urls";

test("relative upload urls become absolute https urls", () => {
  const messages = [{ parts: [{ type: "file", url: "/api/uploads/abc", mediaType: "image/png" }] }];
  assert.equal(healUiHistoryFileUrls(messages, "https://my.example"), 1);
  assert.equal(messages[0]?.parts?.[0]?.url, "https://my.example/api/uploads/abc");
  assert.doesNotThrow(() => new URL(String(messages[0]?.parts?.[0]?.url)));
});

test("rewriteFileUrl accepts upload paths", () => {
  assert.equal(rewriteFileUrl("/api/uploads/abc", "https://my.example"), "https://my.example/api/uploads/abc");
});
