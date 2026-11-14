import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

export class SessionNotFound extends Domain.Rejection("SessionNotFound") {}
export class SessionAlreadyOpen extends Domain.Rejection("SessionAlreadyOpen") {}
export class TransitionRefused extends Domain.Rejection("TransitionRefused", { status: Schema.String, command: Schema.String }) {}
