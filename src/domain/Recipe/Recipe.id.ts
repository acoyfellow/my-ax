import * as Schema from "effect/Schema";

export const RecipeId = Schema.String.pipe(Schema.brand("RecipeId"));
export type RecipeId = typeof RecipeId.Type;
