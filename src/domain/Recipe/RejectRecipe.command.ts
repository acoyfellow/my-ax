import * as Domain from "@alchemy.run/domain";
import { RecipeId } from "./Recipe.id";
import { RecipeNotFound, RecipeTransitionRefused } from "./RecipeRejections.rejection";

export class RecipeRejected extends Domain.Event("RecipeRejected", {}) {}

export class RejectRecipe extends Domain.Command("RejectRecipe", {
  target: RecipeId,
  events: [RecipeRejected],
  rejects: [RecipeNotFound, RecipeTransitionRefused],
}) {}
