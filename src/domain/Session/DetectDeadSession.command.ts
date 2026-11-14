import * as Domain from "@alchemy.run/domain";
import { SessionId } from "./Session.id";
import { SessionNotFound, TransitionRefused } from "./SessionRejections.rejection";

export class DeadSessionDetected extends Domain.Event("DeadSessionDetected", {}) {}

export class DetectDeadSession extends Domain.Command("DetectDeadSession", {
  target: SessionId,
  events: [DeadSessionDetected],
  rejects: [SessionNotFound, TransitionRefused],
}) {}
