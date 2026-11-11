import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("tab leader requests the lock and steps the machine", () => {
  const src = readFileSync(new URL("./tab-leader.svelte.ts", import.meta.url), "utf8");
  assert.match(src, /request\("my-ax-leader"/);
  assert.match(src, /stepLeader/);
});

test("WebPlatform calls navigator.storage.persist", () => {
  const src = readFileSync(new URL("./WebPlatform.svelte", import.meta.url), "utf8");
  assert.match(src, /navigator\.storage\??\.persist\(/);
});
