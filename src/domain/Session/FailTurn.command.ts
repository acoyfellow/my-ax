import * as Domain from "@alchemy.run/domain";
import { SessionId } from "./Session.id";
import { SessionNotFound, TransitionRefused } from "./SessionRejections.rejection";

export class TurnFailed extends Domain.Event("TurnFailed", {}) {}

export class FailTurn extends Domain.Command("FailTurn", {
  target: SessionId,
  events: [TurnFailed],
  rejects: [SessionNotFound, TransitionRefused],
}) {}
