// Reusable owner auto-trust predicate.
//
// Both legacy saved_recipes promotion and the future native CodemodeRuntime
// snippet save path need the same gating rule:
//   - default is owner-gated (a promoted recipe/snippet starts pending);
//   - the owner can flip a deploy-level toggle to opt into auto-trust so
//     promotions land enabled and run without an approval round-trip.
//
// The predicate is pulled into its own module so the snippet save path
// (CodemodeRuntime.saveSnippet hook, future native promotion) and the
// legacy recipe promotion code in agent.ts share one rule. Adding a third
// trust mode (per-recipe allowlist, signed-by-owner attestation, etc.)
// changes one place.

import type { Env } from "./types";

export type AutoTrustMode = "gated" | "auto";

/**
 * Owner-gated by default. Returns "auto" only when an explicit deploy var
 * opts in. Honors both the historic MY_AX_RECIPE_AUTOTRUST and the
 * shorter RECIPE_AUTOTRUST so an existing deploy does not have to be
 * reconfigured. Treats only the literal "1" as truthy so a value of "0"
 * or empty does not accidentally enable trust.
 */
export function autoTrustMode(env: Env): AutoTrustMode {
  const raw = env as unknown as { MY_AX_RECIPE_AUTOTRUST?: string; RECIPE_AUTOTRUST?: string };
  if (raw.MY_AX_RECIPE_AUTOTRUST === "1" || raw.RECIPE_AUTOTRUST === "1") return "auto";
  return "gated";
}

export function shouldAutoTrust(env: Env): boolean {
  return autoTrustMode(env) === "auto";
}

/**
 * Convenience: the saved_recipes status a newly-promoted artifact should
 * land in. Centralized so the legacy saved-recipes promotion and the
 * future native snippet save path agree.
 */
export function initialStatusForPromotion(env: Env): "enabled" | "pending" {
  return shouldAutoTrust(env) ? "enabled" : "pending";
}
