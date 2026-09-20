import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { computerPreviewSrc } from "../computer-id";

test("create_computer iframe URL sends noVNC websocket through the Worker", () => {
  const src = computerPreviewSrc("desk");
  assert.match(src, /^\/api\/computers\/desk\/novnc\/vnc\.html\?/);
  assert.match(src, /autoconnect=1/);
  const path = new URL(src, "https://example.com").searchParams.get("path");
  assert.equal(path, "api/computers/desk/novnc/websockify");
});

test("Hono serves vnc.html and websockify instead of the generic Not found page", async () => {
  const app = new Hono();
  app.get("/api/computers/:id/novnc/vnc.html", (c) => c.text("vnc"));
  app.all("/api/computers/:id/novnc/websockify", (c) => c.text("ws"));
  app.all("/api/computers/:id/novnc/*", (c) => c.text("asset"));
  app.notFound((c) => c.json({ ok: false, error: { message: "Not found", code: "NOT_FOUND" } }, 404));

  const page = await app.request("https://example.com/api/computers/desk/novnc/vnc.html?autoconnect=1");
  assert.equal(page.status, 200);
  assert.equal(await page.text(), "vnc");

  const socket = await app.request("https://example.com/api/computers/desk/novnc/websockify", {
    headers: { Upgrade: "websocket" },
  });
  assert.equal(socket.status, 200);
  assert.equal(await socket.text(), "ws");

  const missing = await app.request("https://example.com/api/computers/desk/missing");
  assert.equal(missing.status, 404);
});

test("computer routes register explicit vnc.html and websockify before the wildcard", () => {
  const source = readFileSync(new URL("./computers.ts", import.meta.url), "utf8");
  assert.match(source, /\/api\/computers\/:id\/novnc\/vnc\.html/);
  assert.match(source, /\/api\/computers\/:id\/novnc\/websockify/);
  const htmlAt = source.indexOf("/novnc/vnc.html");
  const starAt = source.lastIndexOf("/novnc/*");
  assert.ok(htmlAt > 0 && starAt > htmlAt);
});

test("opening a named computer does not wait for VNC before the chat receipt", () => {
  const named = readFileSync(new URL("../named-computer.ts", import.meta.url), "utf8");
  const start = named.indexOf("export async function getNamedComputer");
  const end = named.indexOf("async function processRunning");
  const getFn = named.slice(start, end);
  assert.doesNotMatch(getFn, /ensureComputerDisplay|waitForPort/);
  assert.match(named, /export async function ensureComputerDisplay/);
});
