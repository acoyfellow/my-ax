import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const style = (file: string) => {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  return source.slice(source.indexOf("<style>"));
};

const rule = (css: string, selector: string) => {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} rule exists`);
  return css.slice(start, css.indexOf("}", start));
};

test("the slash menu never scrolls sideways and long triggers truncate instead of widening rows", () => {
  const css = style("./SlashMenu.svelte");
  assert.match(rule(css, ".slash-menu"), /overflow-x: hidden/);
  assert.match(rule(css, ".slash-menu"), /max-width: 100%/);
  assert.match(rule(css, ".slash-menu"), /z-index: 20;/, "stays under the z-30 sidebar so it never paints over it");
  assert.match(rule(css, ".slash-menu__item"), /grid-template-columns: minmax\(0, max-content\) minmax\(0, 1fr\) auto/);
  assert.match(rule(css, ".slash-menu__label"), /text-overflow: ellipsis/);
});

test("the Cmd+K palette and the MCP explorer rows cannot force horizontal scroll either", () => {
  const palette = style("./CommandPalette.svelte");
  assert.match(rule(palette, ".palette ul"), /overflow-x: hidden/);
  assert.match(rule(palette, ".palette li button"), /minmax\(0, max-content\) minmax\(0, 1fr\) auto/);
  const explorer = style("./McpExplorer.svelte");
  assert.match(rule(explorer, ".mcp-explorer__list"), /overflow-x: hidden/);
  assert.match(rule(explorer, ".mcp-explorer__row"), /minmax\(0, max-content\) minmax\(0, 1fr\) auto/);
  assert.match(rule(explorer, "pre"), /overflow-wrap: anywhere/);
});
