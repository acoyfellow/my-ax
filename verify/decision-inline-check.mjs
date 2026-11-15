import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { browserPaths, resolveTarget } from "./targets.mjs";

const base = resolveTarget(process.env.DECISION_URL ?? process.argv[2] ?? "");
if (!base) {
  console.error("usage: node verify/decision-inline-check.mjs local|preview|prod");
  process.exit(2);
}
const { playwright: PLAYWRIGHT, chrome: CHROME, out: OUT } = browserPaths();
if (!existsSync(PLAYWRIGHT) || !existsSync(CHROME)) process.exit(2);
mkdirSync(OUT, { recursive: true });
const { chromium } = await import(PLAYWRIGHT);

const url = new URL(base);
const local = /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
const token = local ? "" : execFileSync("cloudflared", ["access", "token", `-app=${base}`], { encoding: "utf8" }).trim();
const headers = { "content-type": "application/json", ...(token ? { "cf-access-token": token } : {}) };
const api = async (method, path, body) => {
  const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  return { status: response.status, location: response.headers.get("location"), json: await response.json().catch(() => null) };
};

const results = [];
const check = (label, ok, detail = "") => results.push({ label, ok, detail });
let sessionId = null;
let decisionId = null;

try {
  const created = await api("POST", "/api/sessions", { name: `decision-inline-${Date.now()}` });
  sessionId = created.json?.result?.sessionId ?? null;
  check("session created", created.status === 201);
  const seeded = await api("POST", "/api/system/decision-probe", { sessionId, question: "Ship the inline decision?", options: ["Ship", "Hold"] });
  decisionId = seeded.json?.result?.decisionId ?? null;
  check("decision seeded with an inline receipt", seeded.status === 201 && Boolean(decisionId), `status ${seeded.status}`);
  check("decision link points into the thread", seeded.json?.result?.href === `/?session=${sessionId}&decision=${decisionId}`, seeded.json?.result?.href ?? "");
  const legacy = await api("GET", `/api/decisions/${decisionId}`);
  check("old decision page link redirects into the thread", legacy.status === 302 && legacy.location === `/?session=${sessionId}&decision=${decisionId}`, legacy.location ?? String(legacy.status));

  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 } });
      if (token) await context.addCookies([{ name: "CF_Authorization", value: token, domain: url.hostname, path: "/", secure: true, httpOnly: true }]);
      const page = await context.newPage();
      await page.goto(`${base}/?session=${encodeURIComponent(sessionId)}&decision=${encodeURIComponent(decisionId)}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
      const widget = page.locator(`[data-decision-id="${decisionId}"]`);
      const appeared = await widget.waitFor({ state: "visible", timeout: 20_000 }).then(() => true, () => false);
      check(`${width}px inline widget is in the thread`, appeared);
      const popups = await page.evaluate((id) => {
        const decisionDialogs = [...document.querySelectorAll("dialog[open], [role=dialog]")].filter((element) => {
          if (element.getAttribute("data-open") === "0" || element.hasAttribute("inert")) return false;
          return element.querySelector(`[data-decision-id="${id}"]`) !== null;
        });
        const openModals = [...document.querySelectorAll("[aria-modal=true]")].filter((element) => !element.hasAttribute("inert") && element.getAttribute("data-open") !== "0" && element.getBoundingClientRect().width > 0);
        return decisionDialogs.length + openModals.length + document.querySelectorAll("iframe[src*='/api/decisions/']").length;
      }, decisionId);
      check(`${width}px no popup or modal for the decision`, popups === 0, `${popups} dialogs`);
      const inView = appeared && await widget.evaluate((element) => { const box = element.getBoundingClientRect(); return box.top >= 0 && box.bottom <= window.innerHeight + 1; });
      check(`${width}px thread scrolled to the widget`, Boolean(inView));
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`${width}px no sideways scroll`, sideways <= 1, `${sideways}px`);
      await page.screenshot({ path: `${OUT}/decision-open-${width}.png` });
      if (width === 390 && appeared) {
        await widget.getByRole("button", { name: "Hold" }).click();
        const frozen = await page.locator(`[data-decision-id="${decisionId}"][data-decision-phase="answered"]`).waitFor({ timeout: 15_000 }).then(() => true, () => false);
        check("answering freezes the widget inline", frozen);
        check("frozen widget shows the choice", (await widget.innerText()).includes("You chose Hold"));
        check("needs-your-input banner clears after answering", await page.getByRole("link", { name: "Reopen pending decision" }).count() === 0);
        await page.screenshot({ path: `${OUT}/decision-answered-${width}.png` });
      }
      if (width === 1280 && appeared) {
        check("reopening shows the frozen answer", await page.locator(`[data-decision-id="${decisionId}"][data-decision-phase="answered"]`).waitFor({ timeout: 10_000 }).then(() => true, () => false));
        check("frozen widget has no answer buttons", await widget.getByRole("button").count() === 0);
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  const state = await api("GET", `/api/decisions/${decisionId}/state`);
  check("server state is answered with Hold", state.json?.result?.state === "answered" && state.json?.result?.choice === "Hold");
} finally {
  if (decisionId) await api("POST", `/api/runs/${decisionId}/dismiss`, {}).catch(() => undefined);
  if (sessionId) await api("DELETE", `/api/sessions/${sessionId}`).catch(() => undefined);
}

for (const row of results) console.log(`${row.ok ? "PASS" : "FAIL"} ${row.label}${row.detail ? ` (${row.detail})` : ""}`);
const failed = results.filter((row) => !row.ok).length;
console.log(`decision-inline ${base}: ${results.length - failed}/${results.length} pass, cleanup done`);
process.exit(failed === 0 && results.length >= 16 ? 0 : 1);
