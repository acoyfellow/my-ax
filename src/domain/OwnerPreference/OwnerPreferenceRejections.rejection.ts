import * as Domain from "@alchemy.run/domain";

export class OwnerPreferenceNotFound extends Domain.Rejection("OwnerPreferenceNotFound") {}
export class OwnerPreferenceAlreadyExists extends Domain.Rejection("OwnerPreferenceAlreadyExists") {}
