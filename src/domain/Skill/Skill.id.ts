import * as Schema from "effect/Schema";

export const SkillId = Schema.String.pipe(Schema.brand("SkillId"));
export type SkillId = typeof SkillId.Type;
