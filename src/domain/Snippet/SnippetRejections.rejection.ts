import * as Domain from "@alchemy.run/domain";

export class SnippetNotFound extends Domain.Rejection("SnippetNotFound") {}
export class SnippetAlreadyExists extends Domain.Rejection("SnippetAlreadyExists") {}
