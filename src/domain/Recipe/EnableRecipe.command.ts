import * as Domain from "@alchemy.run/domain";
import { RecipeId } from "./Recipe.id";
import { RecipeNotFound, RecipeTransitionRefused } from "./RecipeRejections.rejection";

export class RecipeEnabled extends Domain.Event("RecipeEnabled", {}) {}

export class EnableRecipe extends Domain.Command("EnableRecipe", {
  target: RecipeId,
  events: [RecipeEnabled],
  rejects: [RecipeNotFound, RecipeTransitionRefused],
}) {}
