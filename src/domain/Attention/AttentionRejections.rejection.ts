import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

export class AttentionNotFound extends Domain.Rejection("AttentionNotFound") {}
export class AttentionAlreadyExists extends Domain.Rejection("AttentionAlreadyExists") {}
export class AttentionTransitionRefused extends Domain.Rejection("AttentionTransitionRefused", { status: Schema.String, command: Schema.String }) {}
