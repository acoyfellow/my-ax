import assert from "node:assert/strict";
import { test } from "node:test";
import { wantsWakeLock } from "../wake-lock";
import { keyboardInset } from "./keyboard-inset";

const on = { supported: true, enabled: true, visible: true, busy: false, manual: false };

test("wake lock: held while busy or manual, only when supported, enabled and visible", () => {
  assert.equal(wantsWakeLock({ ...on, busy: true }), true);
  assert.equal(wantsWakeLock({ ...on, manual: true }), true);
  assert.equal(wantsWakeLock(on), false);
  assert.equal(wantsWakeLock({ ...on, busy: true, visible: false }), false);
  assert.equal(wantsWakeLock({ ...on, busy: true, enabled: false }), false);
  assert.equal(wantsWakeLock({ ...on, manual: true, supported: false }), false);
});

test("keyboard inset: prefers the virtual keyboard height", () => {
  assert.equal(keyboardInset({ virtualKeyboardHeight: 300, layoutViewportHeight: 800, visualViewportHeight: 500, visualViewportOffsetTop: 0 }), 300);
});

test("keyboard inset: falls back to the visual viewport gap", () => {
  assert.equal(keyboardInset({ virtualKeyboardHeight: null, layoutViewportHeight: 800, visualViewportHeight: 500, visualViewportOffsetTop: 0 }), 300);
  assert.equal(keyboardInset({ virtualKeyboardHeight: 0, layoutViewportHeight: 800, visualViewportHeight: 500, visualViewportOffsetTop: 40 }), 260);
});

test("keyboard inset: never negative, ignores tiny gaps, rounds to whole pixels", () => {
  assert.equal(keyboardInset({ virtualKeyboardHeight: null, layoutViewportHeight: 800, visualViewportHeight: 900, visualViewportOffsetTop: 0 }), 0);
  assert.equal(keyboardInset({ virtualKeyboardHeight: null, layoutViewportHeight: 800, visualViewportHeight: 790, visualViewportOffsetTop: 0 }), 0);
  assert.equal(keyboardInset({ virtualKeyboardHeight: null, layoutViewportHeight: 800, visualViewportHeight: null, visualViewportOffsetTop: null }), 0);
  assert.equal(keyboardInset({ virtualKeyboardHeight: 301.6, layoutViewportHeight: 800, visualViewportHeight: null, visualViewportOffsetTop: null }), 302);
});
