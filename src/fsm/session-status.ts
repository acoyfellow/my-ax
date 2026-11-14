import { SESSION_COMMAND_FOR_EVENT } from "../domain/shadow";
import { sessionStatusStatement, transitionSessionRecord } from "../domain/Session/Session.store";
export type SessionStatus = "active" | "running" | "error" | "interrupted" | "archived";

export type SessionStatusEvent =
  | "turn_started"
  | "turn_completed"
  | "turn_failed"
  | "turn_aborted"
  | "turn_stuck"
  | "recovery_exhausted"
  | "dead_session_detected"
  | "pi_run_started"
  | "pi_run_settled"
  | "pi_run_settled_failed"
  | "archived"
  | "unarchived";

type Transition = { from: readonly SessionStatus[]; to: SessionStatus; touchUpdatedAt: boolean };

export const SESSION_TRANSITIONS: Readonly<Record<SessionStatusEvent, Transition>> = {
  turn_started: { from: ["active", "error", "interrupted", "running", "archived"], to: "running", touchUpdatedAt: true },
  turn_completed: { from: ["running", "interrupted"], to: "active", touchUpdatedAt: true },
  turn_failed: { from: ["running", "interrupted"], to: "error", touchUpdatedAt: true },
  turn_aborted: { from: ["active", "running", "error", "interrupted"], to: "active", touchUpdatedAt: true },
  turn_stuck: { from: ["running"], to: "active", touchUpdatedAt: true },
  recovery_exhausted: { from: ["active", "running"], to: "interrupted", touchUpdatedAt: true },
  dead_session_detected: { from: ["active", "running"], to: "interrupted", touchUpdatedAt: false },
  pi_run_started: { from: ["active", "error"], to: "running", touchUpdatedAt: true },
  pi_run_settled: { from: ["running", "error"], to: "active", touchUpdatedAt: false },
  pi_run_settled_failed: { from: ["active", "running"], to: "error", touchUpdatedAt: false },
  archived: { from: ["active", "error", "interrupted"], to: "archived", touchUpdatedAt: false },
  unarchived: { from: ["archived"], to: "active", touchUpdatedAt: true },
};

export function nextSessionStatus(current: SessionStatus, event: SessionStatusEvent): SessionStatus | null {
  const transition = SESSION_TRANSITIONS[event];
  return transition.from.includes(current) ? transition.to : null;
}

export interface SessionStatusDb {
  prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown>; first?<T>(): Promise<T | null> } };
}

export interface SessionRef {
  id: string;
  ownerEmail: string;
}

export async function applySessionEvent(db: SessionStatusDb, session: SessionRef, event: SessionStatusEvent): Promise<boolean> {
  const transition = SESSION_TRANSITIONS[event];
  return transitionSessionRecord(db, session, event, { command: SESSION_COMMAND_FOR_EVENT[event], ...sessionStatusStatement(transition) });
}
