import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { purifierFor } from "./safe-markdown";
import { renderUserMarkdown } from "./user-message-markdown";

const purifier = purifierFor(new JSDOM("").window as never);
const render = (text: string) => renderUserMarkdown(text, purifier);

test("an outbound message renders markdown like an inbound one", () => {
  const html = render("**bold** and `code`\n\n- one\n- two\n\n```ts\nconst x = 1;\n```");
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<li>one<\/li>/);
  assert.match(html, /<pre><code class="language-ts">const x = 1;\n<\/code><\/pre>/);
});

test("single line breaks and paragraph breaks in an outbound message are kept", () => {
  const html = render("line one\nline two\n\nnew paragraph");
  assert.match(html, /line one<br>\s*line two/);
  assert.match(html, /<p>new paragraph<\/p>/);
});

test("an outbound message cannot inject script or event handlers", () => {
  const html = render("<img src=x onerror=alert(1)> <script>alert(1)</script> [x](javascript:alert(1))");
  assert.doesNotMatch(html, /onerror|<script|javascript:/i);
});

test("the chat renders user content through the markdown renderer", async () => {
  const chat = await readFile(new URL("./Chat.svelte", import.meta.url), "utf8");
  assert.match(chat, /<div class="msg-user-content[^"]*">\{@html renderUserMessage\(m\.content\)\}<\/div>/);
  assert.doesNotMatch(chat, /\{\/if\}\{m\.content\}<\/div>/);
});
