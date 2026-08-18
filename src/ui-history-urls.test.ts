import assert from "node:assert/strict";
import test from "node:test";
import { rewriteUiHistoryFileUrls } from "./ui-history-urls";

test("relative upload urls become absolute https urls", () => {
  const next = rewriteUiHistoryFileUrls(
    [{ role: "user", parts: [{ type: "file", url: "/api/uploads/abc", mediaType: "image/png" }] }],
    "https://my.example",
  );
  assert.deepEqual(next[0]?.parts, [
    { type: "file", url: "https://my.example/api/uploads/abc", mediaType: "image/png" },
  ]);
  assert.doesNotThrow(() => new URL(String(next[0]?.parts?.[0]?.url)));
});

