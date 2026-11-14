import * as Domain from "@alchemy.run/domain";
import { SessionId } from "./Session.id";
import { SessionNotFound, TransitionRefused } from "./SessionRejections.rejection";

export class TurnCompleted extends Domain.Event("TurnCompleted", {}) {}

export class CompleteTurn extends Domain.Command("CompleteTurn", {
  target: SessionId,
  events: [TurnCompleted],
  rejects: [SessionNotFound, TransitionRefused],
}) {}
