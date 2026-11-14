import * as Domain from "@alchemy.run/domain";
import { SessionId } from "./Session.id";
import { SessionNotFound, TransitionRefused } from "./SessionRejections.rejection";

export class PiRunFailed extends Domain.Event("PiRunFailed", {}) {}

export class FailPiRun extends Domain.Command("FailPiRun", {
  target: SessionId,
  events: [PiRunFailed],
  rejects: [SessionNotFound, TransitionRefused],
}) {}
