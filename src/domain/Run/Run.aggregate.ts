import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { StartRun, RunStarted } from "./StartRun.command";
import { RunId } from "./Run.id";
import { RunAlreadyExists, RunNotFound, RunTransitionRefused } from "./RunRejections.rejection";
import { RecordReceipt, ReceiptRecorded } from "./RecordReceipt.command";
import { SucceedRecipe, RecipeSucceeded } from "./SucceedRecipe.command";
import { FailRecipe, RecipeFailed } from "./FailRecipe.command";
import { AnswerDecision, DecisionAnswered } from "./AnswerDecision.command";
import { ReopenDecision, DecisionReopened } from "./ReopenDecision.command";
import { SupersedeDecision, DecisionSuperseded } from "./SupersedeDecision.command";
import { CompleteRun, RunCompleted } from "./CompleteRun.command";
import { FailRun, RunFailed } from "./FailRun.command";
import { AbortRun, RunAborted } from "./AbortRun.command";

export const RUN_STAGES = ["Open", "Running", "Completed", "Failed", "Aborted"] as const;
export type RunStage = (typeof RUN_STAGES)[number];

export const RunState = Schema.Union([
  Schema.TaggedStruct("Missing", {}),
  Schema.TaggedStruct("Present", { ownerEmail: Schema.String, stage: Schema.Literals(RUN_STAGES) }),
]);
export type RunState = typeof RunState.Type;

type Rule = { from: readonly RunStage[]; to: RunStage; event: () => { readonly _tag: string } };

export const RUN_RULES = {
  RecordReceipt: { from: ["Open"], to: "Running", event: () => new ReceiptRecorded() },
  SucceedRecipe: { from: ["Running"], to: "Completed", event: () => new RecipeSucceeded() },
  FailRecipe: { from: ["Running"], to: "Failed", event: () => new RecipeFailed() },
  AnswerDecision: { from: ["Open"], to: "Completed", event: () => new DecisionAnswered() },
  ReopenDecision: { from: ["Completed"], to: "Open", event: () => new DecisionReopened() },
  SupersedeDecision: { from: ["Open"], to: "Aborted", event: () => new DecisionSuperseded() },
  CompleteRun: { from: ["Open", "Running"], to: "Completed", event: () => new RunCompleted() },
  FailRun: { from: ["Open", "Running"], to: "Failed", event: () => new RunFailed() },
  AbortRun: { from: ["Open", "Running"], to: "Aborted", event: () => new RunAborted() },
} as const satisfies Record<string, Rule>;
export type RunCommandName = keyof typeof RUN_RULES;

function transition<C extends RunCommandName>(current: RunState, command: C) {
  if (current._tag === "Missing") return new RunNotFound();
  const rule: Rule = RUN_RULES[command];
  if (!rule.from.includes(current.stage)) return new RunTransitionRefused({ status: current.stage, command });
  return [rule.event() as ReturnType<(typeof RUN_RULES)[C]["event"]>];
}

const moved = (current: RunState, stage: RunStage): RunState => (current._tag === "Present" ? { ...current, stage } : current);

export class Run extends Domain.Aggregate("Run", {
  id: RunId,
  state: RunState,
  initial: { _tag: "Missing" },
  commands: [StartRun, RecordReceipt, SucceedRecipe, FailRecipe, AnswerDecision, ReopenDecision, SupersedeDecision, CompleteRun, FailRun, AbortRun],
  decide: {
    StartRun: (current, cmd) => (current._tag !== "Missing" ? new RunAlreadyExists() : [new RunStarted({ ownerEmail: cmd.ownerEmail, stage: cmd.stage })]),
    RecordReceipt: (current) => transition(current, "RecordReceipt"),
    SucceedRecipe: (current) => transition(current, "SucceedRecipe"),
    FailRecipe: (current) => transition(current, "FailRecipe"),
    AnswerDecision: (current) => transition(current, "AnswerDecision"),
    ReopenDecision: (current) => transition(current, "ReopenDecision"),
    SupersedeDecision: (current) => transition(current, "SupersedeDecision"),
    CompleteRun: (current) => transition(current, "CompleteRun"),
    FailRun: (current) => transition(current, "FailRun"),
    AbortRun: (current) => transition(current, "AbortRun"),
  },
  evolve: {
    RunStarted: (_, e) => ({ _tag: "Present" as const, ownerEmail: e.ownerEmail, stage: e.stage }),
    ReceiptRecorded: (current) => moved(current, "Running"),
    RecipeSucceeded: (current) => moved(current, "Completed"),
    RecipeFailed: (current) => moved(current, "Failed"),
    DecisionAnswered: (current) => moved(current, "Completed"),
    DecisionReopened: (current) => moved(current, "Open"),
    DecisionSuperseded: (current) => moved(current, "Aborted"),
    RunCompleted: (current) => moved(current, "Completed"),
    RunFailed: (current) => moved(current, "Failed"),
    RunAborted: (current) => moved(current, "Aborted"),
  },
}) {}
