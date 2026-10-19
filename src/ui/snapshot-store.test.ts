import assert from "node:assert/strict";
import { test } from "node:test";
import { PiSnapshotStore } from "./snapshot-store";
import type { PiSnapshot } from "./pi-transcript";

function memory(limit = Infinity) {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      const used = [...data.entries()].filter(([k]) => k !== key).reduce((sum, [, v]) => sum + v.length, 0);
      if (used + value.length > limit) throw new Error("QuotaExceededError");
      data.set(key, value);
    },
    removeItem: (key: string) => { data.delete(key); },
  };
}

const snapshot = (text: string): PiSnapshot => ({ busy: false, model: "m", entries: [{ id: 1, kind: "pi.user", model: [{ role: "user", content: text }] }], partial: null, tools: [], queued: 0 });

test("a saved chat reopens from storage", () => {
  const store = new PiSnapshotStore(memory());
  store.write("a", snapshot("hi"));
  assert.equal(store.read("a")?.entries[0].model?.[0].content, "hi");
});

test("empty chats and unknown chats are not cached", () => {
  const store = new PiSnapshotStore(memory());
  store.write("empty", { ...snapshot("x"), entries: [] });
  assert.equal(store.read("empty"), null);
  assert.equal(store.read("missing"), null);
});

test("only the most recent chats are kept", () => {
  const storage = memory();
  const store = new PiSnapshotStore(storage, 2);
  store.write("a", snapshot("a"));
  store.write("b", snapshot("b"));
  store.write("c", snapshot("c"));
  assert.equal(store.read("a"), null);
  assert.ok(store.read("b"));
  assert.ok(store.read("c"));
});

test("a full storage evicts older chats instead of failing", () => {
  const storage = memory(600);
  const store = new PiSnapshotStore(storage, 8);
  store.write("a", snapshot("a".repeat(150)));
  store.write("b", snapshot("b".repeat(150)));
  store.write("c", snapshot("c".repeat(150)));
  assert.ok(store.read("c"));
});

test("no storage means no cache and no errors", () => {
  const store = new PiSnapshotStore(null);
  store.write("a", snapshot("a"));
  assert.equal(store.read("a"), null);
});
