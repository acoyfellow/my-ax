import * as Domain from "@alchemy.run/domain";
import { RecipeId } from "./Recipe.id";
import { RecipeNotFound } from "./RecipeRejections.rejection";

export class RecipeDeleted extends Domain.Event("RecipeDeleted", {}) {}

export class DeleteRecipe extends Domain.Command("DeleteRecipe", {
  target: RecipeId,
  events: [RecipeDeleted],
  rejects: [RecipeNotFound],
}) {}
