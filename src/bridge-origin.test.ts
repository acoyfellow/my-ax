import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveBridgeOrigin } from "./bridge-origin";

test("resolveBridgeOrigin accepts absolute URL config", () => {
  assert.equal(resolveBridgeOrigin("https://<deployment-host>/path?q=1"), "https://<deployment-host>");
});

test("resolveBridgeOrigin accepts host-only deploy config", () => {
  assert.equal(resolveBridgeOrigin("<deployment-host>"), "https://<deployment-host>");
});

test("resolveBridgeOrigin treats empty or malformed config as unavailable, not an opaque URL throw", () => {
  assert.equal(resolveBridgeOrigin(""), null);
  assert.equal(resolveBridgeOrigin("   "), null);
  assert.equal(resolveBridgeOrigin("http://[not-a-host"), null);
});
