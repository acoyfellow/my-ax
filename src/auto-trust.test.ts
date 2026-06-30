import assert from "node:assert/strict";
import test from "node:test";
import { autoTrustMode, initialStatusForPromotion, shouldAutoTrust } from "./auto-trust";
import type { Env } from "./types";

function makeEnv(over: Record<string, unknown> = {}): Env {
  return over as unknown as Env;
}

test("autoTrustMode defaults to owner-gated when neither flag is set", () => {
  assert.equal(autoTrustMode(makeEnv()), "gated");
  assert.equal(shouldAutoTrust(makeEnv()), false);
  assert.equal(initialStatusForPromotion(makeEnv()), "pending");
});

test("autoTrustMode flips to auto only when MY_AX_RECIPE_AUTOTRUST or RECIPE_AUTOTRUST is literally '1'", () => {
  assert.equal(autoTrustMode(makeEnv({ MY_AX_RECIPE_AUTOTRUST: "1" })), "auto");
  assert.equal(autoTrustMode(makeEnv({ RECIPE_AUTOTRUST: "1" })), "auto");
  assert.equal(autoTrustMode(makeEnv({ MY_AX_RECIPE_AUTOTRUST: "0" })), "gated");
  assert.equal(autoTrustMode(makeEnv({ RECIPE_AUTOTRUST: "true" })), "gated", "only literal '1' enables trust");
  assert.equal(initialStatusForPromotion(makeEnv({ MY_AX_RECIPE_AUTOTRUST: "1" })), "enabled");
});
