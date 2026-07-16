import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { registerBrowserRoutes } from "./browser";

// Mount the browser routes with a stub identity (the replay PAGE route needs no
// DB — it renders HTML and the browser fetches the recording API separately).
function makeApp() {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => { c.set("identity", { email: "owner@example.com", sub: "owner" }); await next(); });
  registerBrowserRoutes(app);
  return app;
}

test("browser replay page CSP allows the inline module script (regression: stuck on 'Loading replay…')", async () => {
  const app = makeApp();
  const res = await app.request("/browser/replay/abc-123");
  assert.equal(res.status, 200);
  const csp = res.headers.get("Content-Security-Policy") ?? "";
  // The page ships an inline <script type="module">. script-src 'self' ALONE
  // blocks it under CSP → the player never runs → permanent "Loading replay…".
  // The script directive must permit inline execution.
  const scriptSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src")) ?? "";
  assert.ok(/\bscript-src\b/.test(csp), "CSP must set script-src");
  assert.ok(scriptSrc.includes("'unsafe-inline'"), `script-src must allow inline script, got: ${scriptSrc}`);
  assert.ok(scriptSrc.includes("'self'"), "script-src must still allow same-origin (the rrweb-player import)");
});

test("browser replay page serves the inline player + Loading placeholder", async () => {
  const res = await makeApp().request("/browser/replay/abc-123");
  const html = await res.text();
  assert.ok(html.includes('<script type="module">'), "must ship the inline module player");
  assert.ok(html.includes("rrweb-player.mjs"), "must import the vendored player");
  assert.ok(html.includes("Loading replay"), "keeps the loading placeholder");
});

test("browser replay CSP lets the reconstructed DOM render its images (img/media data:+blob:)", async () => {
  const res = await makeApp().request("/browser/replay/abc-123");
  const csp = res.headers.get("Content-Security-Policy") ?? "";
  const imgSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("img-src")) ?? "";
  assert.ok(imgSrc.includes("data:") && imgSrc.includes("blob:"), `img-src must allow data:+blob:, got: ${imgSrc}`);
});
