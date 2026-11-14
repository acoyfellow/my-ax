import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { CreateBrowserRecording, BrowserRecordingCreated } from "./CreateBrowserRecording.command";
import { DeleteBrowserRecording, BrowserRecordingDeleted } from "./DeleteBrowserRecording.command";
import { UpdateBrowserRecording, BrowserRecordingUpdated } from "./UpdateBrowserRecording.command";
import { BrowserRecordingFields } from "./BrowserRecording.fields";
import { BrowserRecordingId } from "./BrowserRecording.id";
import { BrowserRecordingAlreadyExists, BrowserRecordingNotFound } from "./BrowserRecordingRejections.rejection";

export const BrowserRecordingState = Schema.Union([
  Schema.TaggedStruct("Missing", {}),
  Schema.TaggedStruct("Present", BrowserRecordingFields),
  Schema.TaggedStruct("Deleted", {}),
]);
export type BrowserRecordingState = typeof BrowserRecordingState.Type;

export class BrowserRecording extends Domain.Aggregate("BrowserRecording", {
  id: BrowserRecordingId,
  state: BrowserRecordingState,
  initial: { _tag: "Missing" },
  commands: [CreateBrowserRecording, UpdateBrowserRecording, DeleteBrowserRecording],
  decide: {
    CreateBrowserRecording: (current, cmd) =>
      current._tag === "Present" ? new BrowserRecordingAlreadyExists() : [new BrowserRecordingCreated({ ownerEmail: cmd.ownerEmail, storageKey: cmd.storageKey })],
    UpdateBrowserRecording: (current, cmd) =>
      current._tag !== "Present" ? new BrowserRecordingNotFound() : [new BrowserRecordingUpdated({ storageKey: cmd.storageKey })],
    DeleteBrowserRecording: (current) => (current._tag !== "Present" ? new BrowserRecordingNotFound() : [new BrowserRecordingDeleted()]),
  },
  evolve: {
    BrowserRecordingCreated: (_, e) => ({ _tag: "Present" as const, ownerEmail: e.ownerEmail, storageKey: e.storageKey }),
    BrowserRecordingUpdated: (current, e) => (current._tag === "Present" ? { ...current, storageKey: e.storageKey } : current),
    BrowserRecordingDeleted: () => ({ _tag: "Deleted" as const }),
  },
}) {}
