#!/usr/bin/env node

import { build } from "esbuild";
import sveltePlugin from "esbuild-svelte";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const uiDir = dirname(fileURLToPath(import.meta.url));
const widget = resolve(uiDir, "ToolResultWidget.svelte");
const work = mkdtempSync(join(tmpdir(), "myax-replay-proof-"));
const outDir = process.env.REPLAY_PROOF_OUT ?? join(work, "out");
mkdirSync(outDir, { recursive: true });

const SCREENSHOT = "/api/artifacts/00000000-0000-4000-8000-000000000000";
const PORT = 8799;

const entry = join(work, "entry.js");
writeFileSync(entry, `
import { mount } from "svelte";
import ToolResultWidget from ${JSON.stringify(widget)};
const base = {
  kind: "browser-run", status: "done", url: "https://example.com",
  title: "Example page", textPreview: "Rendered text preview from the captured page.",
  recorded: true, recordingFormat: "rrweb", note: "recorded",
  screenshotSrc: ${JSON.stringify(SCREENSHOT)},
};
for (const [id, replayUrl] of [["bad", "/browser/replay/bad"], ["good", "/browser/replay/good"]]) {
  mount(ToolResultWidget, {
    target: document.getElementById(id),
    props: { result: { ...base, replayUrl }, toolName: "browser_open" },
  });
}
`);

const html = `<!doctype html><meta charset="utf-8">
<title>Replay fallback proof</title>
<style>
  :root { color-scheme: dark; --color-fg:#e8edf5; --color-fg-mut:#9ca9bd; --color-line:#232936; --color-surface-2:#111a24; }
  body { margin:0; background:#0b0d12; color:var(--color-fg); font:14px system-ui; padding:24px; }
  h1 { font-size:18px; margin:0 0 6px; } p { color:var(--color-fg-mut); margin:0 0 20px; }
  section { border:1px solid var(--color-line); border-radius:10px; padding:16px; margin-bottom:24px; background:#0e141b; }
  h2 { font-size:14px; margin:0 0 10px; }
  .browser-replay-frame { display:block; width:100%; height:280px; margin-top:8px; border:1px solid var(--color-line); border-radius:6px; background:#0b0d12; }
  .browser-replay-unavailable { display:block; width:100%; margin-top:8px; padding:10px 12px; border:1px solid var(--color-line); border-radius:6px; background:var(--color-surface-2); color:var(--color-fg-mut); font-size:.8rem; }
</style>
<h1>Browser Run replay fallback</h1>
<p>Same card, two recordings. The fixed card collapses the missing replay to the screenshot.</p>
<section><h2>Fixed &mdash; recording missing (404)</h2><div id="bad"></div></section>
<section><h2>Healthy &mdash; recording present (200)</h2><div id="good"></div></section>
<script type="module" src="/bundle.js"></script>`;

await build({
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  platform: "browser",
  absWorkingDir: resolve(uiDir, "..", ".."),
  nodePaths: [resolve(uiDir, "..", "..", "node_modules")],
  outfile: join(work, "bundle.js"),
  plugins: [sveltePlugin({ compileOptions: { generate: "client" } })],
  logLevel: "error",
});

const { readFileSync } = await import("node:fs");
const bundle = readFileSync(join(work, "bundle.js"), "utf8");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const routes = {
  "/": [200, "text/html", html],
  "/index.html": [200, "text/html", html],
  "/bundle.js": [200, "text/javascript", bundle],
  "/api/browser/recordings/good": [200, "application/json", JSON.stringify({ ok: true })],
  "/api/browser/recordings/bad": [404, "application/json", JSON.stringify({ ok: false })],
  "/browser/replay/good": [200, "text/html", "<body style='background:#0b0d12;color:#e8edf5;font:13px system-ui'>playable replay</body>"],
  [SCREENSHOT]: [200, "image/png", png],
};

const server = createServer((req, res) => {
  const hit = routes[(req.url || "/").split("?")[0]];
  if (!hit) { res.writeHead(404, { "content-type": "text/plain" }); res.end("not found"); return; }
  res.writeHead(hit[0], { "content-type": hit[1] });
  res.end(hit[2]);
});
await new Promise((ok) => server.listen(PORT, "127.0.0.1", ok));

let pass = false;
let results = {};
try {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1000, height: 620 },
    recordVideo: { dir: join(outDir, "video"), size: { width: 1000, height: 620 } },
  });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  results = {
    badCard_replayUnavailableNote: await page.locator('[data-tool-widget="browser-run-replay-unavailable"]').count(),
    badCard_iframes: await page.locator("#bad iframe.browser-replay-frame").count(),
    badCard_screenshots: await page.locator("#bad img").count(),
    goodCard_iframes: await page.locator("#good iframe.browser-replay-frame").count(),
  };

  await page.locator("#bad").scrollIntoViewIfNeeded();
  await page.waitForTimeout(900);
  await page.locator("#good").scrollIntoViewIfNeeded();
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(outDir, "replay-fallback.png"), fullPage: true });
  await context.close();
  await browser.close();

  const clip = readdirSync(join(outDir, "video")).find((f) => f.endsWith(".webm"));
  if (clip) renameSync(join(outDir, "video", clip), join(outDir, "replay-fallback.webm"));

  pass = results.badCard_replayUnavailableNote === 1
    && results.badCard_iframes === 0
    && results.badCard_screenshots > 0
    && results.goodCard_iframes === 1;
} finally {
  server.close();
  rmSync(work, { recursive: true, force: true });
}

console.log(JSON.stringify(results, null, 2));
console.log(`artifacts: ${outDir}`);
console.log(pass
  ? "# pass browser-replay-fallback: missing recording collapses to screenshot; healthy recording keeps its replay"
  : "# FAIL browser-replay-fallback");
process.exit(pass ? 0 : 1);