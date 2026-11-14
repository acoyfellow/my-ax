import * as Domain from "@alchemy.run/domain";
import { SessionId } from "./Session.id";
import { SessionNotFound, TransitionRefused } from "./SessionRejections.rejection";

export class PiRunSettled extends Domain.Event("PiRunSettled", {}) {}

export class SettlePiRun extends Domain.Command("SettlePiRun", {
  target: SessionId,
  events: [PiRunSettled],
  rejects: [SessionNotFound, TransitionRefused],
}) {}
