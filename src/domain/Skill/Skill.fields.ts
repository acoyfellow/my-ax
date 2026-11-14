import * as Schema from "effect/Schema";

export const SkillFields = {
  ownerEmail: Schema.String,
  name: Schema.String,
  description: Schema.String,
  instructions: Schema.String,
};

export const SkillChanges = {
  name: Schema.String,
  description: Schema.String,
  instructions: Schema.String,
};
