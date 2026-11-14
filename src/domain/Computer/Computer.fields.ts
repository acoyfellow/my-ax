import * as Schema from "effect/Schema";

export const ComputerFields = {
  ownerEmail: Schema.String,
  title: Schema.String,
};

export const ComputerChanges = {
  title: Schema.String,
};
