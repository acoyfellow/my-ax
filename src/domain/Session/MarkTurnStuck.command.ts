import * as Domain from "@alchemy.run/domain";
import { SessionId } from "./Session.id";
import { SessionNotFound, TransitionRefused } from "./SessionRejections.rejection";

export class TurnStuck extends Domain.Event("TurnStuck", {}) {}

export class MarkTurnStuck extends Domain.Command("MarkTurnStuck", {
  target: SessionId,
  events: [TurnStuck],
  rejects: [SessionNotFound, TransitionRefused],
}) {}
