import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

export class RecipeNotFound extends Domain.Rejection("RecipeNotFound") {}
export class RecipeAlreadyExists extends Domain.Rejection("RecipeAlreadyExists") {}
export class RecipeTransitionRefused extends Domain.Rejection("RecipeTransitionRefused", { status: Schema.String, command: Schema.String }) {}
