import * as Domain from "@alchemy.run/domain";
import { RecipeId } from "./Recipe.id";
import { RecipeNotFound } from "./RecipeRejections.rejection";

export class RecipeEdited extends Domain.Event("RecipeEdited", {}) {}

export class EditRecipe extends Domain.Command("EditRecipe", {
  target: RecipeId,
  events: [RecipeEdited],
  rejects: [RecipeNotFound],
}) {}
