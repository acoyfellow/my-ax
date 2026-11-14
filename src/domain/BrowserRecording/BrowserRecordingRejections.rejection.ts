import * as Domain from "@alchemy.run/domain";

export class BrowserRecordingNotFound extends Domain.Rejection("BrowserRecordingNotFound") {}
export class BrowserRecordingAlreadyExists extends Domain.Rejection("BrowserRecordingAlreadyExists") {}
