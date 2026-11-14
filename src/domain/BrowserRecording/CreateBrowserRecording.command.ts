import * as Domain from "@alchemy.run/domain";
import { BrowserRecordingFields } from "./BrowserRecording.fields";
import { BrowserRecordingId } from "./BrowserRecording.id";
import { BrowserRecordingAlreadyExists } from "./BrowserRecordingRejections.rejection";

export class BrowserRecordingCreated extends Domain.Event("BrowserRecordingCreated", BrowserRecordingFields) {}

export class CreateBrowserRecording extends Domain.Command("CreateBrowserRecording", {
  target: BrowserRecordingId,
  input: BrowserRecordingFields,
  events: [BrowserRecordingCreated],
  rejects: [BrowserRecordingAlreadyExists],
}) {}
