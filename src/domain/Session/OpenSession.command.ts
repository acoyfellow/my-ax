import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { SessionId } from "./Session.id";
import { SessionAlreadyOpen } from "./SessionRejections.rejection";

export class SessionOpened extends Domain.Event("SessionOpened", { ownerEmail: Schema.String, name: Schema.String }) {}

export class OpenSession extends Domain.Command("OpenSession", {
  target: SessionId,
  input: { ownerEmail: Schema.String, name: Schema.String },
  events: [SessionOpened],
  rejects: [SessionAlreadyOpen],
}) {}
