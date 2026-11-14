import * as Domain from "@alchemy.run/domain";
import { RunId } from "./Run.id";
import { RunNotFound, RunTransitionRefused } from "./RunRejections.rejection";

export class DecisionReopened extends Domain.Event("DecisionReopened", {}) {}

export class ReopenDecision extends Domain.Command("ReopenDecision", {
  target: RunId,
  events: [DecisionReopened],
  rejects: [RunNotFound, RunTransitionRefused],
}) {}
