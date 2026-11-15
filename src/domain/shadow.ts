import * as DateTime from "effect/DateTime";
import { Job } from "./Job/Job.aggregate";
import { PauseJob } from "./Job/PauseJob.command";
import { ResumeJob } from "./Job/ResumeJob.command";
import { Recipe, type RecipeStage } from "./Recipe/Recipe.aggregate";
import * as RecipeCommands from "./Recipe/commands";
import { Run, type RunStage } from "./Run/Run.aggregate";
import * as RunCommands from "./Run/commands";
import { Session, type SessionStage } from "./Session/Session.aggregate";
import * as SessionCommands from "./Session/commands";

export type ShadowVerdict = "accepted" | "rejected";

export type ShadowRecord = {
  aggregate: string;
  command: string;
  from: string | null;
  sql: ShadowVerdict;
  domain: ShadowVerdict | "unpredictable";
  domainTo: string | null;
  agree: boolean;
};

type Predictor = { predict(state: unknown, command: { readonly _tag: string }, options: { id: string; now: DateTime.Utc }): { _tag: string; state?: unknown } };

export const SESSION_COMMAND_FOR_EVENT: Record<string, keyof typeof SessionCommands.ALL> = {
  turn_started: "StartTurn",
  turn_completed: "CompleteTurn",
  turn_failed: "FailTurn",
  turn_aborted: "AbortTurn",
  turn_stuck: "MarkTurnStuck",
  recovery_exhausted: "ExhaustRecovery",
  dead_session_detected: "DetectDeadSession",
  pi_run_started: "StartPiRun",
  pi_run_settled: "SettlePiRun",
  pi_run_settled_failed: "FailPiRun",
  archived: "ArchiveSession",
  unarchived: "UnarchiveSession",
};

export const RUN_COMMAND: Record<string, keyof typeof RunCommands.ALL> = {
  receipt_recorded: "RecordReceipt",
  recipe_succeeded: "SucceedRecipe",
  recipe_failed: "FailRecipe",
  decision_answered: "AnswerDecision",
  decision_reopened: "ReopenDecision",
  decision_superseded: "SupersedeDecision",
  owner_completed: "CompleteRun",
  owner_failed: "FailRun",
  owner_aborted: "AbortRun",
};

export const RECIPE_COMMAND_FOR_EVENT: Record<string, keyof typeof RecipeCommands.ALL> = {
  approved: "ApproveRecipe",
  rejected: "RejectRecipe",
  enabled: "EnableRecipe",
  disabled: "DisableRecipe",
  returned_to_review: "ReturnRecipeToReview",
};

const capitalize = (status: string) => status.charAt(0).toUpperCase() + status.slice(1);

function judge(
  aggregate: Predictor,
  name: string,
  commandName: string,
  command: object,
  ownerEmail: string,
  from: string | null,
  sql: ShadowVerdict,
): ShadowRecord {
  const state = from === null ? { _tag: "Missing" } : { _tag: "Present", ownerEmail, stage: capitalize(from) };
  const sessionState = from === null ? { _tag: "Unopened" } : { _tag: "Open", ownerEmail, name: "", stage: capitalize(from) };
  const prediction = aggregate.predict(name === "Session" ? sessionState : state, command as { _tag: string }, { id: "shadow", now: DateTime.nowUnsafe() });
  const domain: ShadowRecord["domain"] = prediction._tag === "Accepted" ? "accepted" : prediction._tag === "Rejected" ? "rejected" : "unpredictable";
  const stage = (prediction.state as { stage?: string } | undefined)?.stage ?? null;
  return { aggregate: name, command: commandName, from, sql, domain, domainTo: stage ? stage.toLowerCase() : null, agree: domain === sql };
}

export function shadowSession(event: string, ownerEmail: string, from: string | null, sql: ShadowVerdict): ShadowRecord | null {
  const name = SESSION_COMMAND_FOR_EVENT[event];
  if (!name) return null;
  return judge(Session as unknown as Predictor, "Session", name, new SessionCommands.ALL[name](), ownerEmail, from as SessionStage | null, sql);
}

export function shadowRun(event: string, ownerEmail: string, from: string | null, sql: ShadowVerdict): ShadowRecord | null {
  const name = RUN_COMMAND[event];
  if (!name) return null;
  return judge(Run as unknown as Predictor, "Run", name, new RunCommands.ALL[name](), ownerEmail, from as RunStage | null, sql);
}

export function shadowRecipe(event: string, ownerEmail: string, from: string | null, sql: ShadowVerdict): ShadowRecord | null {
  const name = RECIPE_COMMAND_FOR_EVENT[event];
  if (!name) return null;
  return judge(Recipe as unknown as Predictor, "Recipe", name, new RecipeCommands.ALL[name](), ownerEmail, from as RecipeStage | null, sql);
}

export function shadowJob(event: "paused" | "resumed", ownerEmail: string, from: string | null, sql: ShadowVerdict): ShadowRecord {
  const fields = { ownerEmail, name: "", prompt: "", cadenceSecs: 60, maxRuns: null, runCount: 0 };
  const state = from === null ? { _tag: "Unscheduled" } : from === "exhausted" ? { _tag: "Exhausted", ...fields } : { _tag: capitalize(from), ...fields };
  const command = event === "paused" ? new PauseJob() : new ResumeJob();
  const prediction = (Job as unknown as Predictor).predict(state, command, { id: "shadow", now: DateTime.nowUnsafe() });
  const domain: ShadowRecord["domain"] = prediction._tag === "Accepted" ? "accepted" : prediction._tag === "Rejected" ? "rejected" : "unpredictable";
  const tag = (prediction.state as { _tag?: string } | undefined)?._tag ?? null;
  return { aggregate: "Job", command: command._tag, from, sql, domain, domainTo: tag ? tag.toLowerCase() : null, agree: domain === sql };
}

export function logShadow(record: ShadowRecord | null): void {
  if (!record) return;
  try {
    if (record.agree) console.info("domain.shadow", record);
    else console.warn("domain.shadow.disagree", record);
  } catch {
    return;
  }
}

export function safely(work: () => ShadowRecord | null): void {
  try {
    logShadow(work());
  } catch (error) {
    try {
      console.warn("domain.shadow.error", { message: error instanceof Error ? error.message : String(error) });
    } catch {
      return;
    }
  }
}
