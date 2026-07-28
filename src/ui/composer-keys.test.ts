import assert from "node:assert/strict";
import test from "node:test";
import { decideComposerKey, isMobileComposer } from "./composer-keys";

const base = { key: "Enter", shiftKey: false, isComposing: false, isMobile: false };

test("MOBILE: plain Enter inserts a newline and never sends", () => {
  assert.equal(decideComposerKey({ ...base, isMobile: true }), "newline");
});

test("MOBILE: Shift+Enter also inserts a newline (never sends)", () => {
  assert.equal(decideComposerKey({ ...base, isMobile: true, shiftKey: true }), "newline");
});

test("MOBILE: mid-IME-composition Enter is ignored (never sends)", () => {
  assert.equal(decideComposerKey({ ...base, isMobile: true, isComposing: true }), "ignore");
});

test("DESKTOP: plain Enter sends", () => {
  assert.equal(decideComposerKey({ ...base, isMobile: false }), "send");
});

test("DESKTOP: Shift+Enter inserts a newline", () => {
  assert.equal(decideComposerKey({ ...base, isMobile: false, shiftKey: true }), "newline");
});

test("DESKTOP: mid-IME-composition Enter is ignored (never sends)", () => {
  assert.equal(decideComposerKey({ ...base, isMobile: false, isComposing: true }), "ignore");
});

test("non-Enter keys are ignored on both devices", () => {
  for (const isMobile of [true, false]) {
    assert.equal(decideComposerKey({ ...base, key: "a", isMobile }), "ignore");
    assert.equal(decideComposerKey({ ...base, key: "Tab", isMobile }), "ignore");
  }
});

test("mobile Enter NEVER returns send under any modifier combination", () => {
  for (const shiftKey of [true, false]) {
    for (const isComposing of [true, false]) {
      const decision = decideComposerKey({ key: "Enter", shiftKey, isComposing, isMobile: true });
      assert.notEqual(decision, "send", `mobile Enter must not send (shift=${shiftKey}, composing=${isComposing})`);
    }
  }
});

test("isMobileComposer: coarse pointer => mobile", () => {
  const view = { matchMedia: (q: string) => ({ matches: q.includes("coarse") }) };
  assert.equal(isMobileComposer(view), true);
});

test("isMobileComposer: fine pointer (no coarse match) => desktop", () => {
  const view = { matchMedia: (_q: string) => ({ matches: false }) };
  assert.equal(isMobileComposer(view), false);
});

test("isMobileComposer: falls back to maxTouchPoints when matchMedia is absent", () => {
  assert.equal(isMobileComposer({ maxTouchPoints: 5 }), true);
  assert.equal(isMobileComposer({ maxTouchPoints: 0 }), false);
});

test("isMobileComposer: undefined view (SSR) => false", () => {
  assert.equal(isMobileComposer(undefined), false);
});
