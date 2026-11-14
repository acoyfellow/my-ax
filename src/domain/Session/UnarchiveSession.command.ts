import * as Domain from "@alchemy.run/domain";
import { SessionId } from "./Session.id";
import { SessionNotFound, TransitionRefused } from "./SessionRejections.rejection";

export class SessionUnarchived extends Domain.Event("SessionUnarchived", {}) {}

export class UnarchiveSession extends Domain.Command("UnarchiveSession", {
  target: SessionId,
  events: [SessionUnarchived],
  rejects: [SessionNotFound, TransitionRefused],
}) {}
