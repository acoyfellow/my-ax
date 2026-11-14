import * as Schema from "effect/Schema";

export const WidgetId = Schema.String.pipe(Schema.brand("WidgetId"));
export type WidgetId = typeof WidgetId.Type;
