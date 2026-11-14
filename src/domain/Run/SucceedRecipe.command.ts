import * as Domain from "@alchemy.run/domain";
import { RunId } from "./Run.id";
import { RunNotFound, RunTransitionRefused } from "./RunRejections.rejection";

export class RecipeSucceeded extends Domain.Event("RecipeSucceeded", {}) {}

export class SucceedRecipe extends Domain.Command("SucceedRecipe", {
  target: RunId,
  events: [RecipeSucceeded],
  rejects: [RunNotFound, RunTransitionRefused],
}) {}
