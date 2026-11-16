import * as Domain from "@alchemy.run/domain";

export class ComputerLeaseHeld extends Domain.Rejection("ComputerLeaseHeld") {}
export class ComputerLeaseNotHeld extends Domain.Rejection("ComputerLeaseNotHeld") {}
