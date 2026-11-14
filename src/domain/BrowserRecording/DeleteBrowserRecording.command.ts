import * as Domain from "@alchemy.run/domain";
import { BrowserRecordingId } from "./BrowserRecording.id";
import { BrowserRecordingNotFound } from "./BrowserRecordingRejections.rejection";

export class BrowserRecordingDeleted extends Domain.Event("BrowserRecordingDeleted", {}) {}

export class DeleteBrowserRecording extends Domain.Command("DeleteBrowserRecording", {
  target: BrowserRecordingId,
  events: [BrowserRecordingDeleted],
  rejects: [BrowserRecordingNotFound],
}) {}
