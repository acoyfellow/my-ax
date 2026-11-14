import * as Domain from "@alchemy.run/domain";

export class ComputerNotFound extends Domain.Rejection("ComputerNotFound") {}
export class ComputerAlreadyExists extends Domain.Rejection("ComputerAlreadyExists") {}
