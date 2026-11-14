import * as Domain from "@alchemy.run/domain";

export class EmailNotFound extends Domain.Rejection("EmailNotFound") {}
export class EmailAlreadyExists extends Domain.Rejection("EmailAlreadyExists") {}
