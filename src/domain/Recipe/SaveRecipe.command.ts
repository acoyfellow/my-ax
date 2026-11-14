import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { RecipeId } from "./Recipe.id";
import { RecipeAlreadyExists } from "./RecipeRejections.rejection";

export class RecipeSaved extends Domain.Event("RecipeSaved", { ownerEmail: Schema.String, stage: Schema.Literals(["Pending", "Enabled", "Disabled"]) }) {}

export class SaveRecipe extends Domain.Command("SaveRecipe", {
  target: RecipeId,
  input: { ownerEmail: Schema.String, stage: Schema.Literals(["Pending", "Enabled", "Disabled"]) },
  events: [RecipeSaved],
  rejects: [RecipeAlreadyExists],
}) {}
