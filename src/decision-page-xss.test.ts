import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { createDecision, DECISION_PAGE_SCRIPT, decisionPage, decisionPageCsp, jsonForHtml, registerDecisionRoutes } from "./routes/decisions";

const HOSTILE = [
  "</script><script>alert(document.domain)</script>",
  "<img src=x onerror=alert(1)>",
  "\u2028'\"`${x}&amp;",
];

test("option text cannot close the script element or inject markup into the page", () => {
  const html = decisionPage("run-decision-00000000-0000-4000-8000-000000000000", "<b>q</b>", HOSTILE, null, "/?session=s", "n0nce");
  assert.equal(html.includes("</script><script>alert"), false);
  assert.equal(html.includes("<img src=x"), false);
  assert.equal(html.includes("<b>q</b>"), false);
  const scriptOpenings = html.match(/<script\b/g) ?? [];
  assert.equal(scriptOpenings.length, 2);
  assert.match(html, /<script type="application\/json" id="decision-data">/);
  assert.match(html, /<script nonce="n0nce">/);
});

test("the embedded data round-trips to the exact options", () => {
  const encoded = jsonForHtml({ options: HOSTILE });
  assert.equal(/[<>&\u2028\u2029]/.test(encoded), false);
  assert.deepEqual(JSON.parse(encoded).options, HOSTILE);
});

test("the page CSP only runs the nonced script, never inline or injected scripts", () => {
  const csp = decisionPageCsp("n0nce");
  assert.match(csp, /script-src 'nonce-n0nce'/);
  assert.equal(csp.includes("'unsafe-inline'; style-src") && /script-src[^;]*'unsafe-inline'/.test(csp), false);
  assert.match(csp, /frame-ancestors 'none'/);
});

test("the client script never writes option text as HTML", () => {
  assert.equal(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(DECISION_PAGE_SCRIPT), false);
});

test("after answering, the confirmation shows hostile option text as plain text", async () => {
  const created: Array<{ tag: string; textContent: string }> = [];
  const elements: Record<string, Record<string, unknown>> = {};
  let clickHandler: () => Promise<void> = async () => {};
  const input = { value: "0", disabled: false, addEventListener: (_: string, handler: () => void) => { handler(); } };
  elements["decision-data"] = { textContent: jsonForHtml({ id: "run-decision-x", options: HOSTILE }) };
  elements.submit = { disabled: true, remove() {}, addEventListener: (_: string, handler: () => Promise<void>) => { clickHandler = handler; } };
  elements.status = { textContent: "", children: [] as unknown[], replaceChildren(...nodes: unknown[]) { this.children = nodes; } };
  elements.opts = { replaceChildren() {} };
  const document = {
    getElementById: (id: string) => elements[id],
    querySelectorAll: () => [input],
    createElement: (tag: string) => { const node = { tag, textContent: "" }; created.push(node); return node; },
  };
  const fetch = async () => ({ ok: true, json: async () => ({ ok: true }) });
  new Function("document", "fetch", DECISION_PAGE_SCRIPT)(document, fetch);
  await clickHandler();
  const status = elements.status as { children: unknown[] };
  assert.deepEqual(status.children[0], "Thanks — answered ");
  assert.deepEqual(status.children[1], { tag: "strong", textContent: HOSTILE[0] });
  assert.equal(created.length, 1);
});

test("served decision page is safe for hostile options", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE runs (id TEXT PRIMARY KEY, owner_email TEXT, session_id TEXT, status TEXT DEFAULT 'open', title TEXT, task_summary TEXT, bounds_json TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))); CREATE TABLE run_events (run_id TEXT, event_id TEXT, owner_email TEXT, ts TEXT, actor_json TEXT, type TEXT, data_json TEXT, evidence_json TEXT)");
  const prepare = (sql: string) => ({ bind: (...p: unknown[]) => ({ first: async () => db.prepare(sql).get(...(p as never[])) ?? null, all: async () => ({ results: db.prepare(sql).all(...(p as never[])) }), run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...(p as never[])).changes) } }) }) });
  const env = { DB: { prepare } } as never;
  const app = new Hono();
  app.use("*", async (c, next) => { (c as never as { set: (k: string, v: unknown) => void }).set("identity", { email: "o@x" }); await next(); });
  registerDecisionRoutes(app as never);
  const d = await createDecision(env, "o@x", "s", "Pick", ["</script><script>alert(1)</script>", "b"]);
  const response = await app.request(`/api/decisions/${d.id}`, {}, env);
  const html = await response.text();
  assert.equal(html.includes("</script><script>alert(1)</script>"), false, "option breaks out of script");
  assert.equal(/script-src[^;]*'unsafe-inline'/.test(response.headers.get("content-security-policy") ?? ""), false, "CSP allows inline script");
  assert.equal(/innerHTML='Thanks/.test(html), false, "innerHTML sink");
});

test("the browser replay page refuses ids that are not recording ids and never echoes markup", async () => {
  const { registerBrowserRoutes } = await import("./routes/browser");
  const app = new Hono();
  app.use("*", async (c, next) => { (c as never as { set: (k: string, v: unknown) => void }).set("identity", { email: "o@x" }); await next(); });
  registerBrowserRoutes(app as never);
  const hostile = await app.request(`/browser/replay/${encodeURIComponent("</script><script>alert(1)</script>")}`, {}, {} as never);
  assert.equal(hostile.status, 404);
  assert.equal((await hostile.text()).includes("<script>alert"), false);
  const real = await app.request("/browser/replay/083b8bd3-db42-40dc-ba80-b1baefb44af7", {}, {} as never);
  assert.equal(real.status, 200);
  assert.match(await real.text(), /const id="083b8bd3-db42-40dc-ba80-b1baefb44af7"/);
});
