import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryDraftStore, pipCapability, rootDraftKey, storageDraftStore, widgetTurn, widgetTurnLabel } from "./root-widget-state";

test("the floating window is offered only when the API exists", () => {
  assert.equal(pipCapability(undefined).available, false);
  assert.equal(pipCapability({}).available, false);
  assert.equal(pipCapability({ documentPictureInPicture: {} }).available, false);
  assert.equal(pipCapability({ documentPictureInPicture: { requestWindow: () => null }, isSecureContext: false }).available, false);
  assert.equal(pipCapability({ documentPictureInPicture: { requestWindow: () => null }, isSecureContext: true }).available, true);
});

test("a missing API explains itself", () => {
  const result = pipCapability({ isSecureContext: true });
  assert.equal(result.available, false);
  assert.match(result.available ? "" : result.reason, /Chrome or Edge/);
});

test("the draft survives moving between inline and floating", () => {
  const backing = new Map<string, string>();
  const storage = { getItem: (k: string) => backing.get(k) ?? null, setItem: (k: string, v: string) => { backing.set(k, v); }, removeItem: (k: string) => { backing.delete(k); } };
  const key = rootDraftKey("r1");
  const inline = storageDraftStore(storage, key);
  inline.set("half a thought");
  const floating = storageDraftStore(storage, key);
  assert.equal(floating.get(), "half a thought");
  floating.set("half a thought, finished");
  assert.equal(storageDraftStore(storage, key).get(), "half a thought, finished");
  floating.set("");
  assert.equal(backing.has(key), false);
});

test("a broken storage falls back to memory", () => {
  const storage = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => { throw new Error("denied"); } };
  const store = storageDraftStore(storage, "k");
  store.set("kept");
  assert.equal(store.get(), "kept");
  assert.equal(memoryDraftStore("x").get(), "x");
});

test("the widget shows working, error, offline and ready", () => {
  assert.equal(widgetTurn({ connected: false, busy: true, lastRole: null }), "offline");
  assert.equal(widgetTurn({ connected: true, busy: true, lastRole: "error" }), "working");
  assert.equal(widgetTurn({ connected: true, busy: false, lastRole: "error" }), "error");
  assert.equal(widgetTurn({ connected: true, busy: false, lastRole: "assistant" }), "idle");
  assert.equal(widgetTurnLabel("error"), "Last turn failed");
});
