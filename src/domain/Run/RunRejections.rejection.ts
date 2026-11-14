import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

export class RunNotFound extends Domain.Rejection("RunNotFound") {}
export class RunAlreadyExists extends Domain.Rejection("RunAlreadyExists") {}
export class RunTransitionRefused extends Domain.Rejection("RunTransitionRefused", { status: Schema.String, command: Schema.String }) {}
