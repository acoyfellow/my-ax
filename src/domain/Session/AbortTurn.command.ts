import * as Domain from "@alchemy.run/domain";
import { SessionId } from "./Session.id";
import { SessionNotFound, TransitionRefused } from "./SessionRejections.rejection";

export class TurnAborted extends Domain.Event("TurnAborted", {}) {}

export class AbortTurn extends Domain.Command("AbortTurn", {
  target: SessionId,
  events: [TurnAborted],
  rejects: [SessionNotFound, TransitionRefused],
}) {}
