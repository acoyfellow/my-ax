import { ApproveRecipe } from "./ApproveRecipe.command";
import { RejectRecipe } from "./RejectRecipe.command";
import { EnableRecipe } from "./EnableRecipe.command";
import { DisableRecipe } from "./DisableRecipe.command";
import { ReturnRecipeToReview } from "./ReturnRecipeToReview.command";
import type { RecipeCommandName } from "./Recipe.aggregate";

export const ALL: Record<RecipeCommandName, new () => object> = {
  ApproveRecipe,
  RejectRecipe,
  EnableRecipe,
  DisableRecipe,
  ReturnRecipeToReview,
};
