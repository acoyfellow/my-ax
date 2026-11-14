import * as Schema from "effect/Schema";

export const BrowserRecordingId = Schema.String.pipe(Schema.brand("BrowserRecordingId"));
export type BrowserRecordingId = typeof BrowserRecordingId.Type;
