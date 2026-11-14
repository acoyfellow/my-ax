import * as Domain from "@alchemy.run/domain";
import { RunId } from "./Run.id";
import { RunNotFound, RunTransitionRefused } from "./RunRejections.rejection";

export class DecisionSuperseded extends Domain.Event("DecisionSuperseded", {}) {}

export class SupersedeDecision extends Domain.Command("SupersedeDecision", {
  target: RunId,
  events: [DecisionSuperseded],
  rejects: [RunNotFound, RunTransitionRefused],
}) {}
