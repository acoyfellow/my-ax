import assert from "node:assert/strict";
import test from "node:test";
import { WEB_FEATURE_STORAGE_PREFIX, readWebFeatures, writeWebFeature } from "./web-features";

function memory() {
  const map = new Map<string, string>();
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value), map };
}

test("each web feature starts at its default and remembers the owner's choice", () => {
  const store = memory();
  assert.equal(readWebFeatures(store).wakeLock, true);
  writeWebFeature(store, "wakeLock", false);
  assert.equal(store.map.get(WEB_FEATURE_STORAGE_PREFIX + "wakeLock"), "off");
  assert.equal(readWebFeatures(store).wakeLock, false);
  writeWebFeature(store, "wakeLock", true);
  assert.equal(readWebFeatures(store).wakeLock, true);
});

test("no storage falls back to the defaults", () => {
  assert.equal(readWebFeatures(null).wakeLock, true);
});
