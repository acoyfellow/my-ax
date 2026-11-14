import * as Domain from "@alchemy.run/domain";
import { SessionId } from "./Session.id";
import { SessionNotFound, TransitionRefused } from "./SessionRejections.rejection";

export class TurnStarted extends Domain.Event("TurnStarted", {}) {}

export class StartTurn extends Domain.Command("StartTurn", {
  target: SessionId,
  events: [TurnStarted],
  rejects: [SessionNotFound, TransitionRefused],
}) {}
