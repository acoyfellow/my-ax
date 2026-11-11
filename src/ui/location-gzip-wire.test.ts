import test from "node:test";
import assert from "node:assert/strict";
import { handleLocationRequest } from "./location-request";
import { downloadMaybeGzip } from "./gzip-download";

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

test("downloadMaybeGzip plans compression from the blob", async () => {
  const saved: string[] = [];
  const receipts: string[] = [];
  const big = new Blob(["x".repeat(5000)], { type: "text/plain" });
  await downloadMaybeGzip(big, "a.txt", { enabled: () => true, receipt: (t) => receipts.push(t), save: (_b, n) => saved.push(n) });
  assert.deepEqual(saved, ["a.txt.gz"]);
  assert.match(receipts[0], /^Downloaded a\.txt\.gz \(gzip, 4\.9 KB to /);
  await downloadMaybeGzip(big, "b.txt", { enabled: () => false, receipt: (t) => receipts.push(t), save: (_b, n) => saved.push(n) });
  assert.equal(saved[1], "b.txt");
  assert.equal(receipts.length, 1);
});
