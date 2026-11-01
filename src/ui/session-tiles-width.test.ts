import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./Sessions.svelte", import.meta.url), "utf8");

test("pinned tile columns can shrink below their longest title", () => {
  const rule = source.match(/\.session-tiles \{[^}]*\}/)?.[0] ?? "";
  assert.match(rule, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
});

test("a pinned tile lets its title ellipsize instead of widening the grid", () => {
  const rule = source.match(/:global\(\.session-tile\) \{[^}]*\}/)?.[0] ?? "";
  assert.match(rule, /min-width:\s*0/);
});
