import * as Domain from "@alchemy.run/domain";
import { RecipeId } from "./Recipe.id";
import { RecipeNotFound, RecipeTransitionRefused } from "./RecipeRejections.rejection";

export class RecipeReturnedToReview extends Domain.Event("RecipeReturnedToReview", {}) {}

export class ReturnRecipeToReview extends Domain.Command("ReturnRecipeToReview", {
  target: RecipeId,
  events: [RecipeReturnedToReview],
  rejects: [RecipeNotFound, RecipeTransitionRefused],
}) {}
