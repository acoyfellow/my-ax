import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { marked } from "marked";
import { hardenLinks, purifierFor, sanitizeRenderedMarkdown } from "./safe-markdown";

const { window } = new JSDOM("");
const document = window.document;
const purifier = purifierFor(window as never);
const render = (md: string) => sanitizeRenderedMarkdown(marked.parse(md) as string, purifier);

test("model output cannot inject script, event handlers or javascript: links into the chat", () => {
  const attacks = [
    "<img src=x onerror=alert(1)>",
    "<script>alert(1)</script>",
    "[x](javascript:alert(1))",
    "[x](JaVaScRiPt:alert(1))",
    "<a href=\"data:text/html,<script>alert(1)</script>\">x</a>",
    "<svg onload=alert(1)>",
    "<iframe src=\"https://evil.example\"></iframe>",
    "<form action=\"https://evil.example\"><button>go</button></form>",
    "<div style=\"position:fixed;inset:0\">overlay</div>",
    "<math><mtext><img src=x onerror=alert(1)></mtext></math>",
  ];
  for (const attack of attacks) {
    const html = render(attack).toLowerCase();
    assert.equal(/onerror|onload|<script|javascript:|data:text|<iframe|<form|<svg|style=/.test(html), false, `${attack} => ${html}`);
  }
});

test("ordinary markdown still renders", () => {
  const html = render("# Title\n\n**bold** and `code` and [docs](https://example.com/a?b=1) and [local](/runs)\n\n```ts\nconst x = 1 < 2;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n![img](https://example.com/i.png)");
  for (const expected of ["<h1", "<strong>bold</strong>", "<code>code</code>", 'href="https://example.com/a?b=1"', 'href="/runs"', "<pre>", "&lt;", "<table", '<img src="https://example.com/i.png"']) {
    assert.ok(html.includes(expected), `missing ${expected} in ${html}`);
  }
});

test("external links open in a new tab without access to the app window", () => {
  const container = document.createElement("div");
  container.innerHTML = render("[out](https://example.com) [in](/runs)");
  hardenLinks(container as never);
  const [out, local] = Array.from(container.querySelectorAll("a")) as Element[];
  assert.equal(out.getAttribute("rel"), "noopener noreferrer");
  assert.equal(out.getAttribute("target"), "_blank");
  assert.equal(local.getAttribute("target"), null);
});

test("the chat renders every markdown block through the sanitizer", async () => {
  const { readFile } = await import("node:fs/promises");
  const chat = await readFile(new URL("./Chat.svelte", import.meta.url), "utf8");
  assert.match(chat, /let html = sanitizeRenderedMarkdown\(marked\.parse\(md \?\? ""\) as string\);/);
  assert.equal((chat.match(/marked\.parse\(/g) ?? []).length, 1);
  assert.equal((chat.match(/\{@html /g) ?? []).length, 1);
});
