import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { CreateAudioMessage, AudioMessageCreated } from "./CreateAudioMessage.command";
import { DeleteAudioMessage, AudioMessageDeleted } from "./DeleteAudioMessage.command";
import { UpdateAudioMessage, AudioMessageUpdated } from "./UpdateAudioMessage.command";
import { AudioMessageFields } from "./AudioMessage.fields";
import { AudioMessageId } from "./AudioMessage.id";
import { AudioMessageAlreadyExists, AudioMessageNotFound } from "./AudioMessageRejections.rejection";

export const AudioMessageState = Schema.Union([
  Schema.TaggedStruct("Missing", {}),
  Schema.TaggedStruct("Present", AudioMessageFields),
  Schema.TaggedStruct("Deleted", {}),
]);
export type AudioMessageState = typeof AudioMessageState.Type;

export class AudioMessage extends Domain.Aggregate("AudioMessage", {
  id: AudioMessageId,
  state: AudioMessageState,
  initial: { _tag: "Missing" },
  commands: [CreateAudioMessage, UpdateAudioMessage, DeleteAudioMessage],
  decide: {
    CreateAudioMessage: (current, cmd) =>
      current._tag === "Present" ? new AudioMessageAlreadyExists() : [new AudioMessageCreated({ ownerEmail: cmd.ownerEmail, storageKey: cmd.storageKey })],
    UpdateAudioMessage: (current, cmd) =>
      current._tag !== "Present" ? new AudioMessageNotFound() : [new AudioMessageUpdated({ storageKey: cmd.storageKey })],
    DeleteAudioMessage: (current) => (current._tag !== "Present" ? new AudioMessageNotFound() : [new AudioMessageDeleted()]),
  },
  evolve: {
    AudioMessageCreated: (_, e) => ({ _tag: "Present" as const, ownerEmail: e.ownerEmail, storageKey: e.storageKey }),
    AudioMessageUpdated: (current, e) => (current._tag === "Present" ? { ...current, storageKey: e.storageKey } : current),
    AudioMessageDeleted: () => ({ _tag: "Deleted" as const }),
  },
}) {}
