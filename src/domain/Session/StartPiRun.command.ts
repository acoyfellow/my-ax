import * as Domain from "@alchemy.run/domain";
import { SessionId } from "./Session.id";
import { SessionNotFound, TransitionRefused } from "./SessionRejections.rejection";

export class PiRunStarted extends Domain.Event("PiRunStarted", {}) {}

export class StartPiRun extends Domain.Command("StartPiRun", {
  target: SessionId,
  events: [PiRunStarted],
  rejects: [SessionNotFound, TransitionRefused],
}) {}
