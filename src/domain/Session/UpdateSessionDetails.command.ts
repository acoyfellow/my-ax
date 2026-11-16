import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { SessionId } from "./Session.id";
import { SessionNotFound } from "./SessionRejections.rejection";

export const SESSION_DETAILS = ["name", "pin", "touch", "engine", "amber", "style"] as const;
export type SessionDetail = (typeof SESSION_DETAILS)[number];

export class SessionDetailsUpdated extends Domain.Event("SessionDetailsUpdated", { detail: Schema.Literals(SESSION_DETAILS), name: Schema.NullOr(Schema.String) }) {}

export class UpdateSessionDetails extends Domain.Command("UpdateSessionDetails", {
  target: SessionId,
  input: { detail: Schema.Literals(SESSION_DETAILS), name: Schema.NullOr(Schema.String) },
  events: [SessionDetailsUpdated],
  rejects: [SessionNotFound],
}) {}
