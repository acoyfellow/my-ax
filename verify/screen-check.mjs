import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { browserPaths, resolveTarget } from "./targets.mjs";

const base = resolveTarget(process.env.SCREEN_URL ?? process.argv[2] ?? "");
if (!base) {
  console.error("usage: node verify/screen-check.mjs local|preview|prod");
  process.exit(2);
}

const { playwright: PLAYWRIGHT, chrome: CHROME, out: OUT } = browserPaths();
const WIDTHS = [390, 768, 1280];

if (!existsSync(PLAYWRIGHT) || !existsSync(CHROME)) {
  console.error(`missing browser tooling: ${!existsSync(PLAYWRIGHT) ? PLAYWRIGHT : CHROME}`);
  process.exit(2);
}
const { chromium } = await import(PLAYWRIGHT);
mkdirSync(OUT, { recursive: true });

const url = new URL(base);
const local = /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
const token = local ? "" : execFileSync("cloudflared", ["access", "token", `-app=${base}`], { encoding: "utf8" }).trim();

const browser = await chromium.launch({ executablePath: CHROME });
const results = [];
try {
  for (const width of WIDTHS) {
    const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, deviceScaleFactor: 1 });
    if (token) await context.addCookies([{ name: "CF_Authorization", value: token, domain: url.hostname, path: "/", secure: true, httpOnly: true }]);
    const page = await context.newPage();
    await page.goto(base + "/", { waitUntil: "networkidle", timeout: 45_000 }).catch(() => page.waitForLoadState("domcontentloaded"));
    await page.waitForSelector("header[role=banner]", { timeout: 20_000 });
    await page.waitForTimeout(800);

    const sideways = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
    await page.screenshot({ path: `${OUT}/home-${width}.png` });
    results.push({ width, check: "no sideways scroll on home", ok: sideways <= 1, detail: `overflow ${sideways}px` });

    const bell = page.getByRole("button", { name: /notifications/i }).first();
    await bell.click();
    await page.waitForTimeout(500);
    const rail = await page.evaluate(() => {
      const element = document.querySelector(".notif-rail[data-open='1']");
      if (!element) return null;
      const box = element.getBoundingClientRect();
      const header = document.querySelector("header[role=banner]")?.getBoundingClientRect();
      return { top: Math.round(box.top), right: Math.round(box.right), width: Math.round(box.width), headerBottom: Math.round(header?.bottom ?? 0), overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth };
    });
    await page.screenshot({ path: `${OUT}/notifications-${width}.png` });
    results.push({ width, check: "notifications rail starts at the top", ok: rail !== null && rail.top <= 1, detail: rail ? `top ${rail.top}px, header bottom ${rail.headerBottom}px` : "rail did not open" });
    results.push({ width, check: "notifications rail fits the screen", ok: rail !== null && rail.right <= width + 1 && rail.overflow <= 1, detail: rail ? `right ${rail.right}px, overflow ${rail.overflow}px` : "rail did not open" });
    await context.close();
  }
} finally {
  await browser.close();
}

for (const row of results) console.log(`${row.ok ? "PASS" : "FAIL"} ${row.width}px ${row.check} (${row.detail})`);
const failed = results.filter((row) => !row.ok).length;
console.log(`screens ${base}: ${results.length - failed}/${results.length} pass, saved to ${OUT}`);
process.exit(failed === 0 && results.length === WIDTHS.length * 3 ? 0 : 1);
