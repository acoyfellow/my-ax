import { RecordReceipt } from "./RecordReceipt.command";
import { SucceedRecipe } from "./SucceedRecipe.command";
import { FailRecipe } from "./FailRecipe.command";
import { AnswerDecision } from "./AnswerDecision.command";
import { ReopenDecision } from "./ReopenDecision.command";
import { SupersedeDecision } from "./SupersedeDecision.command";
import { CompleteRun } from "./CompleteRun.command";
import { FailRun } from "./FailRun.command";
import { AbortRun } from "./AbortRun.command";
import type { RunCommandName } from "./Run.aggregate";

export const ALL: Record<RunCommandName, new () => object> = {
  RecordReceipt,
  SucceedRecipe,
  FailRecipe,
  AnswerDecision,
  ReopenDecision,
  SupersedeDecision,
  CompleteRun,
  FailRun,
  AbortRun,
};
