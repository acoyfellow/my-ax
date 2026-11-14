import * as Domain from "@alchemy.run/domain";
import { SessionId } from "./Session.id";
import { SessionNotFound, TransitionRefused } from "./SessionRejections.rejection";

export class RecoveryExhausted extends Domain.Event("RecoveryExhausted", {}) {}

export class ExhaustRecovery extends Domain.Command("ExhaustRecovery", {
  target: SessionId,
  events: [RecoveryExhausted],
  rejects: [SessionNotFound, TransitionRefused],
}) {}
