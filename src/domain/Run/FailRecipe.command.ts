import * as Domain from "@alchemy.run/domain";
import { RunId } from "./Run.id";
import { RunNotFound, RunTransitionRefused } from "./RunRejections.rejection";

export class RecipeFailed extends Domain.Event("RecipeFailed", {}) {}

export class FailRecipe extends Domain.Command("FailRecipe", {
  target: RunId,
  events: [RecipeFailed],
  rejects: [RunNotFound, RunTransitionRefused],
}) {}
