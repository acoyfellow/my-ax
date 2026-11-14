import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

export class JobNotFound extends Domain.Rejection("JobNotFound") {}
export class JobAlreadyExists extends Domain.Rejection("JobAlreadyExists") {}
export class JobExhausted extends Domain.Rejection("JobExhausted", { runCount: Schema.Int }) {}
export class JobNotActive extends Domain.Rejection("JobNotActive", { status: Schema.String }) {}
export class JobNotPaused extends Domain.Rejection("JobNotPaused", { status: Schema.String }) {}
