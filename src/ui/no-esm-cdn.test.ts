import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const CDN_ORIGIN = "https://esm.sh";

for (const file of ["../ui/Chat.svelte", "../routes/artifacts.ts"]) {
  test(`${file} does not load modules from ${CDN_ORIGIN}`, () => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.equal(source.includes(CDN_ORIGIN), false);
  });
}
