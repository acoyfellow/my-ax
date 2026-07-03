export type RecipeApprovalDecision = {
  notify: boolean;
  reason: "auto_trust" | "owner_review_required" | "high_authority_inline_only";
};

export function recipeApprovalDecision(input: {
  autoTrust: boolean;
  capabilities: string[];
  portable?: boolean;
}): RecipeApprovalDecision {
  if (input.autoTrust) return { notify: false, reason: "auto_trust" };
  const highAuthority = input.capabilities.some((capability) =>
    capability.startsWith("machine.") || capability.startsWith("cloudbox."),
  );
  if (highAuthority && input.portable === false) {
    return { notify: false, reason: "high_authority_inline_only" };
  }
  return { notify: true, reason: "owner_review_required" };
}

export function shouldPersistSuggestedRecipe(decision: RecipeApprovalDecision): boolean {
  return decision.reason !== "high_authority_inline_only";
}
