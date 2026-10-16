import { test } from "node:test";
import assert from "node:assert/strict";
import { CONVERSATION_MIN_WIDTH, DEFAULT_LAYOUT, PANEL_MAX_WIDTH, PANEL_MIN_WIDTH, canDock, clampPanelWidth, parseLayout } from "./side-panel-layout";

test("panel width stops at its minimum and maximum", () => {
  assert.equal(clampPanelWidth(10, 1600), PANEL_MIN_WIDTH);
  assert.equal(clampPanelWidth(9999, 1600), PANEL_MAX_WIDTH);
  assert.equal(clampPanelWidth(333, 1600), 333);
});

test("the conversation never gets narrower than its readable minimum", () => {
  const viewport = 1000;
  assert.equal(viewport - clampPanelWidth(PANEL_MAX_WIDTH, viewport) >= CONVERSATION_MIN_WIDTH, true);
});

test("phones never dock the panel", () => {
  assert.equal(canDock(390), false);
  assert.equal(canDock(1280), true);
});

test("a saved layout round-trips and bad storage falls back to the default", () => {
  assert.deepEqual(parseLayout(JSON.stringify({ open: false, width: 320 })), { open: false, width: 320 });
  assert.deepEqual(parseLayout("not json"), DEFAULT_LAYOUT);
  assert.deepEqual(parseLayout(null), DEFAULT_LAYOUT);
});
