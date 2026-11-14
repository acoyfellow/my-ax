import * as Schema from "effect/Schema";

export const WidgetFields = {
  ownerEmail: Schema.String,
  title: Schema.String,
  sourceHash: Schema.String,
  librarySaved: Schema.Boolean,
};

export const WidgetChanges = {
  title: Schema.String,
  sourceHash: Schema.String,
  librarySaved: Schema.Boolean,
};
