import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("keyboard inset module computes and sets the css variable", () => {
  const source = read("./keyboard-inset.svelte.ts");
  assert.match(source, /keyboardInset\(/);
  assert.match(source, /--keyboard-inset/);
});

test("scroll progress css is gated by @supports", () => {
  const css = read("../styles/app.css");
  assert.match(css, /@supports \(animation-timeline: scroll\(\)\)[\s\S]*animation-timeline: scroll\(nearest block\)/);
});
