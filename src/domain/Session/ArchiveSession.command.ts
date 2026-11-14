import * as Domain from "@alchemy.run/domain";
import { SessionId } from "./Session.id";
import { SessionNotFound, TransitionRefused } from "./SessionRejections.rejection";

export class SessionArchived extends Domain.Event("SessionArchived", {}) {}

export class ArchiveSession extends Domain.Command("ArchiveSession", {
  target: SessionId,
  events: [SessionArchived],
  rejects: [SessionNotFound, TransitionRefused],
}) {}
