import * as Domain from "@alchemy.run/domain";
import { AudioMessageChanges } from "./AudioMessage.fields";
import { AudioMessageId } from "./AudioMessage.id";
import { AudioMessageNotFound } from "./AudioMessageRejections.rejection";

export class AudioMessageUpdated extends Domain.Event("AudioMessageUpdated", AudioMessageChanges) {}

export class UpdateAudioMessage extends Domain.Command("UpdateAudioMessage", {
  target: AudioMessageId,
  input: AudioMessageChanges,
  events: [AudioMessageUpdated],
  rejects: [AudioMessageNotFound],
}) {}
