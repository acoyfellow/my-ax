import * as Domain from "@alchemy.run/domain";

export class AudioMessageNotFound extends Domain.Rejection("AudioMessageNotFound") {}
export class AudioMessageAlreadyExists extends Domain.Rejection("AudioMessageAlreadyExists") {}
