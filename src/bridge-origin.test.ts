import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveBridgeOrigin } from "./bridge-origin";

test("resolveBridgeOrigin accepts absolute URL config", () => {
  assert.equal(resolveBridgeOrigin("https://my.ax.cloudflare.dev/path?q=1"), "https://my.ax.cloudflare.dev");
});

test("resolveBridgeOrigin accepts host-only deploy config", () => {
  assert.equal(resolveBridgeOrigin("my.ax.cloudflare.dev"), "https://my.ax.cloudflare.dev");
});

test("resolveBridgeOrigin treats empty or malformed config as unavailable, not an opaque URL throw", () => {
  assert.equal(resolveBridgeOrigin(""), null);
  assert.equal(resolveBridgeOrigin("   "), null);
  assert.equal(resolveBridgeOrigin("http://[not-a-host"), null);
});
