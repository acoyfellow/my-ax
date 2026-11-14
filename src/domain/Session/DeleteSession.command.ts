import * as Domain from "@alchemy.run/domain";
import { SessionId } from "./Session.id";
import { SessionNotFound } from "./SessionRejections.rejection";

export class SessionDeleted extends Domain.Event("SessionDeleted", {}) {}

export class DeleteSession extends Domain.Command("DeleteSession", {
  target: SessionId,
  events: [SessionDeleted],
  rejects: [SessionNotFound],
}) {}
