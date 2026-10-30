import assert from "node:assert/strict";
import test from "node:test";
import { bridgeOrigins, originVerdict } from "./request-origin-guard";

const APP = "https://app.example";
const request = (method: string, headers: Record<string, string>, path = "/api/push/test") => ({ method, url: `${APP}${path}`, headers: new Headers(headers) });

test("a cross-site form or fetch that changes state is refused", () => {
  assert.equal(originVerdict(request("POST", { origin: "https://evil.example" }), []).allowed, false);
  assert.equal(originVerdict(request("DELETE", { origin: "https://evil.example" }), []).allowed, false);
  assert.equal(originVerdict(request("POST", { origin: "null" }), []).allowed, false);
  assert.equal(originVerdict(request("POST", { "sec-fetch-site": "cross-site" }), []).allowed, false);
});

test("a cross-site WebSocket to an agent is refused", () => {
  assert.equal(originVerdict(request("GET", { origin: "https://evil.example", upgrade: "websocket" }, "/agents/pi-chat/x"), []).allowed, false);
  assert.equal(originVerdict(request("GET", { origin: APP, upgrade: "websocket" }, "/agents/pi-chat/x"), []).allowed, true);
});

test("the app itself, the bridge origin and non-browser clients keep working", () => {
  assert.equal(originVerdict(request("POST", { origin: APP, "sec-fetch-site": "same-origin" }), []).allowed, true);
  assert.equal(originVerdict(request("POST", { origin: "https://bridge.example" }), ["https://bridge.example"]).allowed, true);
  assert.equal(originVerdict(request("POST", {}), []).allowed, true);
  assert.equal(originVerdict(request("GET", { origin: "https://evil.example" }), []).allowed, true);
  assert.deepEqual(bridgeOrigins({ BRIDGE_BASE_URL: "https://bridge.example/path" }), ["https://bridge.example"]);
  assert.deepEqual(bridgeOrigins({ BRIDGE_BASE_URL: "not a url" }), []);
});

test("the guard runs on every route before CORS", async () => {
  const { readFile } = await import("node:fs/promises");
  const index = await readFile(new URL("./index.tsx", import.meta.url), "utf8");
  assert.ok(index.indexOf('app.use("*", requestOriginGuard(bridgeOrigins));') >= 0);
  assert.ok(index.indexOf('app.use("*", requestOriginGuard(bridgeOrigins));') < index.indexOf('app.use("*", cors());'));
});
