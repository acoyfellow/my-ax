import test from "node:test";
import assert from "node:assert/strict";
import { handleLocationRequest } from "./location-request";

function setNav(value: unknown) {
  Object.defineProperty(globalThis, "navigator", { value, configurable: true });
}

test("location refuses when disabled and coarsens when enabled", async () => {
  const receipts: string[] = [];
  const toasts: string[] = [];
  setNav({
    geolocation: {
      getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: 12.3456, longitude: 65.4321, accuracy: 20 } }),
    },
  });
  const off = await handleLocationRequest({ enabled: () => false, pushSystem: (t) => toasts.push(t), receipt: (t) => receipts.push(t) });
  assert.deepEqual(off, { ok: false, reason: "Location disabled" });
  const on = await handleLocationRequest({ enabled: () => true, pushSystem: (t) => toasts.push(t), receipt: (t) => receipts.push(t) });
  assert.deepEqual(on, { ok: true, position: { latitude: 12.35, longitude: 65.43, accuracyMeters: 1000 } });
  assert.equal(toasts.length, 1);
  assert.equal(receipts.length, 2);
});


test("the agent reaches location only through the getLocation page verb, which reads the owner switch", async () => {
  const { readFileSync } = await import("node:fs");
  const registry = readFileSync(new URL("./page-registry.ts", import.meta.url), "utf8");
  const verb = registry.slice(registry.indexOf('name: "getLocation"'), registry.indexOf('name: "listArtifactTools"'));
  assert.ok(verb.includes("handleLocationRequest"), "the verb uses the coarsening handler");
  assert.ok(verb.includes("enabled: () => webFeatures.location"), "the verb is gated on the owner switch");
  assert.ok(verb.includes('recordWebReceipt("location"'), "every call leaves a receipt");
});
