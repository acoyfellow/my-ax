import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { OpenSession, SessionOpened } from "./OpenSession.command";
import { SessionId } from "./Session.id";
import { SessionAlreadyOpen, SessionNotFound, TransitionRefused } from "./SessionRejections.rejection";
import { StartTurn, TurnStarted } from "./StartTurn.command";
import { CompleteTurn, TurnCompleted } from "./CompleteTurn.command";
import { FailTurn, TurnFailed } from "./FailTurn.command";
import { AbortTurn, TurnAborted } from "./AbortTurn.command";
import { MarkTurnStuck, TurnStuck } from "./MarkTurnStuck.command";
import { ExhaustRecovery, RecoveryExhausted } from "./ExhaustRecovery.command";
import { DetectDeadSession, DeadSessionDetected } from "./DetectDeadSession.command";
import { StartPiRun, PiRunStarted } from "./StartPiRun.command";
import { SettlePiRun, PiRunSettled } from "./SettlePiRun.command";
import { FailPiRun, PiRunFailed } from "./FailPiRun.command";
import { ArchiveSession, SessionArchived } from "./ArchiveSession.command";
import { UnarchiveSession, SessionUnarchived } from "./UnarchiveSession.command";

export const SESSION_STAGES = ["Active", "Running", "Error", "Interrupted", "Archived"] as const;
export type SessionStage = (typeof SESSION_STAGES)[number];

export const SessionState = Schema.Union([
  Schema.TaggedStruct("Unopened", {}),
  Schema.TaggedStruct("Open", { ownerEmail: Schema.String, name: Schema.String, stage: Schema.Literals(SESSION_STAGES) }),
]);
export type SessionState = typeof SessionState.Type;

type Rule = { from: readonly SessionStage[]; to: SessionStage; event: () => { readonly _tag: string } };

export const SESSION_RULES = {
  StartTurn: { from: ["Active", "Error", "Interrupted", "Running", "Archived"], to: "Running", event: () => new TurnStarted() },
  CompleteTurn: { from: ["Running", "Interrupted"], to: "Active", event: () => new TurnCompleted() },
  FailTurn: { from: ["Running", "Interrupted"], to: "Error", event: () => new TurnFailed() },
  AbortTurn: { from: ["Active", "Running", "Error", "Interrupted"], to: "Active", event: () => new TurnAborted() },
  MarkTurnStuck: { from: ["Running"], to: "Active", event: () => new TurnStuck() },
  ExhaustRecovery: { from: ["Active", "Running"], to: "Interrupted", event: () => new RecoveryExhausted() },
  DetectDeadSession: { from: ["Active", "Running"], to: "Interrupted", event: () => new DeadSessionDetected() },
  StartPiRun: { from: ["Active", "Error"], to: "Running", event: () => new PiRunStarted() },
  SettlePiRun: { from: ["Running", "Error"], to: "Active", event: () => new PiRunSettled() },
  FailPiRun: { from: ["Active", "Running"], to: "Error", event: () => new PiRunFailed() },
  ArchiveSession: { from: ["Active", "Error", "Interrupted"], to: "Archived", event: () => new SessionArchived() },
  UnarchiveSession: { from: ["Archived"], to: "Active", event: () => new SessionUnarchived() },
} as const satisfies Record<string, Rule>;
export type SessionCommandName = keyof typeof SESSION_RULES;

function transition<C extends SessionCommandName>(session: SessionState, command: C) {
  if (session._tag === "Unopened") return new SessionNotFound();
  const rule: Rule = SESSION_RULES[command];
  if (!rule.from.includes(session.stage)) return new TransitionRefused({ status: session.stage, command });
  return [rule.event() as ReturnType<(typeof SESSION_RULES)[C]["event"]>];
}

const moved = (s: SessionState, stage: SessionStage): SessionState => (s._tag === "Open" ? { ...s, stage } : s);

export class Session extends Domain.Aggregate("Session", {
  id: SessionId,
  state: SessionState,
  initial: { _tag: "Unopened" },
  commands: [OpenSession, StartTurn, CompleteTurn, FailTurn, AbortTurn, MarkTurnStuck, ExhaustRecovery, DetectDeadSession, StartPiRun, SettlePiRun, FailPiRun, ArchiveSession, UnarchiveSession],
  decide: {
    OpenSession: (session, cmd) => (session._tag !== "Unopened" ? new SessionAlreadyOpen() : [new SessionOpened({ ownerEmail: cmd.ownerEmail, name: cmd.name })]),
    StartTurn: (session) => transition(session, "StartTurn"),
    CompleteTurn: (session) => transition(session, "CompleteTurn"),
    FailTurn: (session) => transition(session, "FailTurn"),
    AbortTurn: (session) => transition(session, "AbortTurn"),
    MarkTurnStuck: (session) => transition(session, "MarkTurnStuck"),
    ExhaustRecovery: (session) => transition(session, "ExhaustRecovery"),
    DetectDeadSession: (session) => transition(session, "DetectDeadSession"),
    StartPiRun: (session) => transition(session, "StartPiRun"),
    SettlePiRun: (session) => transition(session, "SettlePiRun"),
    FailPiRun: (session) => transition(session, "FailPiRun"),
    ArchiveSession: (session) => transition(session, "ArchiveSession"),
    UnarchiveSession: (session) => transition(session, "UnarchiveSession"),
  },
  evolve: {
    SessionOpened: (_, e) => ({ _tag: "Open" as const, ownerEmail: e.ownerEmail, name: e.name, stage: "Active" as const }),
    TurnStarted: (s) => moved(s, "Running"),
    TurnCompleted: (s) => moved(s, "Active"),
    TurnFailed: (s) => moved(s, "Error"),
    TurnAborted: (s) => moved(s, "Active"),
    TurnStuck: (s) => moved(s, "Active"),
    RecoveryExhausted: (s) => moved(s, "Interrupted"),
    DeadSessionDetected: (s) => moved(s, "Interrupted"),
    PiRunStarted: (s) => moved(s, "Running"),
    PiRunSettled: (s) => moved(s, "Active"),
    PiRunFailed: (s) => moved(s, "Error"),
    SessionArchived: (s) => moved(s, "Archived"),
    SessionUnarchived: (s) => moved(s, "Active"),
  },
}) {}
