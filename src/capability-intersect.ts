// Capability intersection helper.
//
// Centralizes the rule that an inner caller (a saved snippet / recipe being
// invoked from inside a turn that already has bounded capability grants)
// must NEVER widen the effective capability set. The snippet's declared
// capabilities are what the snippet *claims* to need; the caller's grants
// are what the parent turn was allowed to do; the effective grant for the
// snippet run is the intersection of the two.
//
// Round 02 objection #7 — "Snippet hook can still broaden turn-level
// capabilities because legacy saved recipe execution uses the recipe's
// declared capabilities rather than intersecting with caller grants" —
// is fixed by routing every snippet/recipe execution through this
// helper.

export function intersectCapabilities(callerGrants: string[] | undefined, declared: string[]): string[] {
  // When the caller is unrestricted (typical top-level turn that has not
  // narrowed capabilities), the effective set is exactly the snippet's
  // declared capabilities — nothing to broaden against an unset bound.
  if (callerGrants === undefined) return [...new Set(declared)].sort();
  const allowed = new Set(callerGrants);
  return [...new Set(declared.filter((capability) => allowed.has(capability)))].sort();
}

/**
 * Diagnostic: capabilities the snippet declared but the caller does not
 * grant. Useful to report a clear receipt explaining why a snippet was
 * narrowed.
 */
export function capabilitiesDropped(callerGrants: string[] | undefined, declared: string[]): string[] {
  if (callerGrants === undefined) return [];
  const allowed = new Set(callerGrants);
  return [...new Set(declared.filter((capability) => !allowed.has(capability)))].sort();
}
