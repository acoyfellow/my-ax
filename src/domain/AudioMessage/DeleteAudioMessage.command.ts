import * as Domain from "@alchemy.run/domain";
import { AudioMessageId } from "./AudioMessage.id";
import { AudioMessageNotFound } from "./AudioMessageRejections.rejection";

export class AudioMessageDeleted extends Domain.Event("AudioMessageDeleted", {}) {}

export class DeleteAudioMessage extends Domain.Command("DeleteAudioMessage", {
  target: AudioMessageId,
  events: [AudioMessageDeleted],
  rejects: [AudioMessageNotFound],
}) {}
