import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { computerPreviewSrc } from "../computer-id";

test("create_computer iframe URL loads the voxl screen page through the Worker", () => {
  assert.equal(computerPreviewSrc("desk"), "/api/computers/desk/screen/");
});

test("Hono routes the screen page, its assets and its socket to one handler", async () => {
  const app = new Hono();
  app.all("/api/computers/:id/screen", (c) => c.redirect(`${c.req.path}/`, 301));
  app.all("/api/computers/:id/screen/*", (c) => c.text("screen"));
  app.notFound((c) => c.json({ ok: false, error: { message: "Not found", code: "NOT_FOUND" } }, 404));

  for (const path of ["/", "/client.js", "/worker.js", "/ws"]) {
    const res = await app.request(`https://example.com/api/computers/desk/screen${path}`);
    assert.equal(res.status, 200, path);
  }
  const bare = await app.request("https://example.com/api/computers/desk/screen");
  assert.equal(bare.status, 301);
  assert.equal(bare.headers.get("location"), "/api/computers/desk/screen/");
  assert.equal((await app.request("https://example.com/api/computers/desk/missing")).status, 404);
});

test("computer routes register the screen proxy and no noVNC routes", () => {
  const source = readFileSync(new URL("./computers.ts", import.meta.url), "utf8");
  assert.match(source, /\/api\/computers\/:id\/screen\/\*/);
  assert.equal(source.includes("novnc"), false);
});
