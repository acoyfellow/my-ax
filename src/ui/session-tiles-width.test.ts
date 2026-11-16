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

test("the search row and the tile grid share one side inset and one gap", () => {
  const shared = source.match(/\.sessions-head, \.sessions-scroll \{[^}]*\}/)?.[0] ?? "";
  assert.match(shared, /padding-inline:\s*var\(--rail-inset\)/);
  assert.match(shared, /scrollbar-gutter:\s*stable/);
  const tools = source.match(/\.sessions-tools \{[^}]*\}/)?.[0] ?? "";
  assert.match(tools, /gap:\s*var\(--rail-gap\)/);
  const tiles = source.match(/\.session-tiles \{[^}]*\}/)?.[0] ?? "";
  assert.match(tiles, /gap:\s*var\(--rail-gap\)/);
  assert.match(tiles, /padding:\s*0 0 8px/);
  assert.doesNotMatch(source, /class="flex-none flex flex-col p-2\.5"/);
  assert.doesNotMatch(source, /\[scrollbar-width:thin\] px-2 pb-3/);
});
