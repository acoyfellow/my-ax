import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const chat = await readFile(new URL("./Chat.svelte", import.meta.url), "utf8");
const styles = await readFile(new URL("../styles/app.css", import.meta.url), "utf8");

test("user content owns whitespace preservation instead of its template container", () => {
  assert.match(chat, /<div class="msg-user-content">\{m\.content\}<\/div>/);
  assert.match(styles, /\.msg-user \.msg-body \{[\s\S]*?white-space: normal;/);
  assert.match(styles, /\.msg-user-content \{ white-space: pre-wrap; \}/);
});

test("the composer still removes accidental boundary whitespace", () => {
  assert.match(chat, /const text = composerText\.trim\(\);/);
  assert.doesNotMatch(chat, /const text = composerText;\s+if \(!text\.trim\(\)/);
});
