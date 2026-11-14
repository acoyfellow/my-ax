import * as Domain from "@alchemy.run/domain";
import { RunId } from "./Run.id";
import { RunNotFound, RunTransitionRefused } from "./RunRejections.rejection";

export class DecisionAnswered extends Domain.Event("DecisionAnswered", {}) {}

export class AnswerDecision extends Domain.Command("AnswerDecision", {
  target: RunId,
  events: [DecisionAnswered],
  rejects: [RunNotFound, RunTransitionRefused],
}) {}
