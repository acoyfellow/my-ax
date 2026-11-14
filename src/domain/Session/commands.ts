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
import type { SessionCommandName } from "./Session.aggregate";

export { StartTurn, TurnStarted, CompleteTurn, TurnCompleted, FailTurn, TurnFailed, AbortTurn, TurnAborted, MarkTurnStuck, TurnStuck, ExhaustRecovery, RecoveryExhausted, DetectDeadSession, DeadSessionDetected, StartPiRun, PiRunStarted, SettlePiRun, PiRunSettled, FailPiRun, PiRunFailed, ArchiveSession, SessionArchived, UnarchiveSession, SessionUnarchived };

export const ALL: Record<SessionCommandName, new () => object> = {
  StartTurn,
  CompleteTurn,
  FailTurn,
  AbortTurn,
  MarkTurnStuck,
  ExhaustRecovery,
  DetectDeadSession,
  StartPiRun,
  SettlePiRun,
  FailPiRun,
  ArchiveSession,
  UnarchiveSession,
};
