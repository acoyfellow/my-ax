import * as Domain from "@alchemy.run/domain";
import { RecipeId } from "./Recipe.id";
import { RecipeNotFound, RecipeTransitionRefused } from "./RecipeRejections.rejection";

export class RecipeDisabled extends Domain.Event("RecipeDisabled", {}) {}

export class DisableRecipe extends Domain.Command("DisableRecipe", {
  target: RecipeId,
  events: [RecipeDisabled],
  rejects: [RecipeNotFound, RecipeTransitionRefused],
}) {}
