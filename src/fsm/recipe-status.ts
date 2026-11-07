export type RecipeStatus = "pending" | "enabled" | "disabled";

export type RecipeStatusEvent = "approved" | "rejected" | "enabled" | "disabled" | "returned_to_review";

const TRANSITIONS: Readonly<Record<RecipeStatusEvent, { from: readonly RecipeStatus[]; to: RecipeStatus }>> = {
  approved: { from: ["pending", "disabled"], to: "enabled" },
  rejected: { from: ["pending", "enabled", "disabled"], to: "disabled" },
  enabled: { from: ["disabled", "enabled"], to: "enabled" },
  disabled: { from: ["enabled", "disabled", "pending"], to: "disabled" },
  returned_to_review: { from: ["pending", "enabled", "disabled"], to: "pending" },
};

export function initialRecipeStatus(requested: unknown): RecipeStatus {
  if (requested === "enabled") return "enabled";
  if (requested === "disabled") return "disabled";
  return "pending";
}

export function nextRecipeStatus(current: RecipeStatus, event: RecipeStatusEvent): RecipeStatus | null {
  const transition = TRANSITIONS[event];
  return transition.from.includes(current) ? transition.to : null;
}

export function patchStatusEvent(requested: RecipeStatus): RecipeStatusEvent {
  if (requested === "enabled") return "enabled";
  if (requested === "disabled") return "disabled";
  return "returned_to_review";
}

export class RecipeTransitionError extends Error {
  constructor(readonly from: RecipeStatus, readonly event: RecipeStatusEvent) {
    super(from === "pending" && event === "enabled" ? "a pending recipe must be approved before it can be enabled" : `a ${from} recipe cannot take the ${event} step`);
  }
}

export function requireRecipeTransition(current: RecipeStatus, event: RecipeStatusEvent): RecipeStatus {
  const next = nextRecipeStatus(current, event);
  if (!next) throw new RecipeTransitionError(current, event);
  return next;
}
