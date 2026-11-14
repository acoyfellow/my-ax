import * as Domain from "@alchemy.run/domain";
import { AudioMessageFields } from "./AudioMessage.fields";
import { AudioMessageId } from "./AudioMessage.id";
import { AudioMessageAlreadyExists } from "./AudioMessageRejections.rejection";

export class AudioMessageCreated extends Domain.Event("AudioMessageCreated", AudioMessageFields) {}

export class CreateAudioMessage extends Domain.Command("CreateAudioMessage", {
  target: AudioMessageId,
  input: AudioMessageFields,
  events: [AudioMessageCreated],
  rejects: [AudioMessageAlreadyExists],
}) {}
