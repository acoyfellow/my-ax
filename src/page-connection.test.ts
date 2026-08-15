import assert from "node:assert/strict";
import test from "node:test";
import { pageConnectionScore, selectPageConnection, selectLivePageConnection } from "./page-connection";

test("visible standalone mobile PWA wins over a visible desktop tab", () => {
  const desktop = { id: "desktop", state: { chatVisible: true, standalone: false, uaMobile: false } };
  const pwa = { id: "pwa", state: { chatVisible: true, standalone: true, uaMobile: true } };
  assert.equal(selectPageConnection([desktop, pwa]), pwa);
});

test("visible browser wins when the standalone PWA is backgrounded", () => {
  const desktop = { id: "desktop", state: { chatVisible: true, standalone: false, uaMobile: false } };
  const pwa = { id: "pwa", state: { chatVisible: false, standalone: true, uaMobile: true } };
  assert.equal(selectPageConnection([pwa, desktop]), desktop);
});

test("standalone mobile PWA wins among background clients", () => {
  const desktop = { id: "desktop", state: { chatVisible: false, standalone: false, uaMobile: false } };
  const pwa = { id: "pwa", state: { chatVisible: false, standalone: true, uaMobile: true } };
  assert.equal(selectPageConnection([desktop, pwa]), pwa);
});

test("selectLivePageConnection ignores a background-only tab", () => {
  const hidden = { id: "hidden", state: { chatVisible: false, standalone: true, uaMobile: true } };
  assert.equal(selectLivePageConnection([hidden]), undefined);
});

test("selectLivePageConnection keeps a visible chat tab", () => {
  const visible = { id: "visible", state: { chatVisible: true } };
  assert.equal(selectLivePageConnection([visible]), visible);
});

test("connection scoring is deterministic", () => {
  assert.equal(pageConnectionScore({ chatVisible: true, standalone: true, uaMobile: true }), 7);
  assert.equal(pageConnectionScore({ chatVisible: true }), 4);
  assert.equal(pageConnectionScore({ standalone: true, uaMobile: true }), 3);
  assert.equal(pageConnectionScore(), 0);
});
