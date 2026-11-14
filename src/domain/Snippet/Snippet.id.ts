import * as Schema from "effect/Schema";

export const SnippetId = Schema.String.pipe(Schema.brand("SnippetId"));
export type SnippetId = typeof SnippetId.Type;
