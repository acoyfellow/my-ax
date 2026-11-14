import * as Domain from "@alchemy.run/domain";
import { RecipeId } from "./Recipe.id";
import { RecipeNotFound, RecipeTransitionRefused } from "./RecipeRejections.rejection";

export class RecipeApproved extends Domain.Event("RecipeApproved", {}) {}

export class ApproveRecipe extends Domain.Command("ApproveRecipe", {
  target: RecipeId,
  events: [RecipeApproved],
  rejects: [RecipeNotFound, RecipeTransitionRefused],
}) {}
