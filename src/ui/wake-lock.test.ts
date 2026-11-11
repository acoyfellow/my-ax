import assert from "node:assert/strict";
import test from "node:test";
import { wantsWakeLock } from "./wake-lock";

const on = { supported: true, enabled: true, visible: true, busy: false, manual: false };

test("the screen stays on while a turn runs or the owner asked for it", () => {
  assert.equal(wantsWakeLock({ ...on, busy: true }), true);
  assert.equal(wantsWakeLock({ ...on, manual: true }), true);
  assert.equal(wantsWakeLock(on), false);
});

test("the off switch, a hidden tab or a browser without Wake Lock always release it", () => {
  assert.equal(wantsWakeLock({ ...on, busy: true, enabled: false }), false);
  assert.equal(wantsWakeLock({ ...on, busy: true, visible: false }), false);
  assert.equal(wantsWakeLock({ ...on, manual: true, supported: false }), false);
});
