import * as Domain from "@alchemy.run/domain";
import { BrowserRecordingChanges } from "./BrowserRecording.fields";
import { BrowserRecordingId } from "./BrowserRecording.id";
import { BrowserRecordingNotFound } from "./BrowserRecordingRejections.rejection";

export class BrowserRecordingUpdated extends Domain.Event("BrowserRecordingUpdated", BrowserRecordingChanges) {}

export class UpdateBrowserRecording extends Domain.Command("UpdateBrowserRecording", {
  target: BrowserRecordingId,
  input: BrowserRecordingChanges,
  events: [BrowserRecordingUpdated],
  rejects: [BrowserRecordingNotFound],
}) {}
