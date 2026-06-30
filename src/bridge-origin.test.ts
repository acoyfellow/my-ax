import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveBridgeOrigin } from "./bridge-origin";

test("resolveBridgeOrigin accepts absolute URL config", () => {
  assert.equal(resolveBridgeOrigin("https://ax.example.com/path?q=1"), "https://ax.example.com");
});

test("resolveBridgeOrigin accepts host-only deploy config", () => {
  assert.equal(resolveBridgeOrigin("ax.example.com"), "https://ax.example.com");
});

test("resolveBridgeOrigin treats empty or malformed config as unavailable, not an opaque URL throw", () => {
  assert.equal(resolveBridgeOrigin(""), null);
  assert.equal(resolveBridgeOrigin("   "), null);
  assert.equal(resolveBridgeOrigin("http://[not-a-host"), null);
});
