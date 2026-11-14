import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { SaveRecipe, RecipeSaved } from "./SaveRecipe.command";
import { RecipeId } from "./Recipe.id";
import { RecipeAlreadyExists, RecipeNotFound, RecipeTransitionRefused } from "./RecipeRejections.rejection";
import { ApproveRecipe, RecipeApproved } from "./ApproveRecipe.command";
import { RejectRecipe, RecipeRejected } from "./RejectRecipe.command";
import { EnableRecipe, RecipeEnabled } from "./EnableRecipe.command";
import { DisableRecipe, RecipeDisabled } from "./DisableRecipe.command";
import { ReturnRecipeToReview, RecipeReturnedToReview } from "./ReturnRecipeToReview.command";

export const RECIPE_STAGES = ["Pending", "Enabled", "Disabled"] as const;
export type RecipeStage = (typeof RECIPE_STAGES)[number];

export const RecipeState = Schema.Union([
  Schema.TaggedStruct("Missing", {}),
  Schema.TaggedStruct("Present", { ownerEmail: Schema.String, stage: Schema.Literals(RECIPE_STAGES) }),
]);
export type RecipeState = typeof RecipeState.Type;

type Rule = { from: readonly RecipeStage[]; to: RecipeStage; event: () => { readonly _tag: string } };

export const RECIPE_RULES = {
  ApproveRecipe: { from: ["Pending", "Disabled"], to: "Enabled", event: () => new RecipeApproved() },
  RejectRecipe: { from: ["Pending", "Enabled", "Disabled"], to: "Disabled", event: () => new RecipeRejected() },
  EnableRecipe: { from: ["Disabled", "Enabled"], to: "Enabled", event: () => new RecipeEnabled() },
  DisableRecipe: { from: ["Enabled", "Disabled", "Pending"], to: "Disabled", event: () => new RecipeDisabled() },
  ReturnRecipeToReview: { from: ["Pending", "Enabled", "Disabled"], to: "Pending", event: () => new RecipeReturnedToReview() },
} as const satisfies Record<string, Rule>;
export type RecipeCommandName = keyof typeof RECIPE_RULES;

function transition<C extends RecipeCommandName>(current: RecipeState, command: C) {
  if (current._tag === "Missing") return new RecipeNotFound();
  const rule: Rule = RECIPE_RULES[command];
  if (!rule.from.includes(current.stage)) return new RecipeTransitionRefused({ status: current.stage, command });
  return [rule.event() as ReturnType<(typeof RECIPE_RULES)[C]["event"]>];
}

const moved = (current: RecipeState, stage: RecipeStage): RecipeState => (current._tag === "Present" ? { ...current, stage } : current);

export class Recipe extends Domain.Aggregate("Recipe", {
  id: RecipeId,
  state: RecipeState,
  initial: { _tag: "Missing" },
  commands: [SaveRecipe, ApproveRecipe, RejectRecipe, EnableRecipe, DisableRecipe, ReturnRecipeToReview],
  decide: {
    SaveRecipe: (current, cmd) => (current._tag !== "Missing" ? new RecipeAlreadyExists() : [new RecipeSaved({ ownerEmail: cmd.ownerEmail, stage: cmd.stage })]),
    ApproveRecipe: (current) => transition(current, "ApproveRecipe"),
    RejectRecipe: (current) => transition(current, "RejectRecipe"),
    EnableRecipe: (current) => transition(current, "EnableRecipe"),
    DisableRecipe: (current) => transition(current, "DisableRecipe"),
    ReturnRecipeToReview: (current) => transition(current, "ReturnRecipeToReview"),
  },
  evolve: {
    RecipeSaved: (_, e) => ({ _tag: "Present" as const, ownerEmail: e.ownerEmail, stage: e.stage }),
    RecipeApproved: (current) => moved(current, "Enabled"),
    RecipeRejected: (current) => moved(current, "Disabled"),
    RecipeEnabled: (current) => moved(current, "Enabled"),
    RecipeDisabled: (current) => moved(current, "Disabled"),
    RecipeReturnedToReview: (current) => moved(current, "Pending"),
  },
}) {}
