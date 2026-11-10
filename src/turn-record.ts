import { Data, Effect } from "effect";

export type TurnRecord = {
  sessionId: string;
  ownerEmail: string;
  startedAt: string;
  heartbeatAt: string;
  toolsRunning: number;
};

export interface TurnDb {
  prepare(sql: string): {
    bind(...binds: unknown[]): {
      all<T = unknown>(): Promise<{ results?: T[] }>;
      first<T = unknown>(): Promise<T | null>;
      run(): Promise<unknown>;
    };
  };
}

class TurnRecordError extends Data.TaggedError("TurnRecordError")<{ operation: string; cause: unknown }> {}

function operation<A>(name: string, run: () => Promise<A>): Effect.Effect<A, TurnRecordError> {
  return Effect.tryPromise({ try: run, catch: (cause) => new TurnRecordError({ operation: name, cause }) });
}

export function startTurnRecord(db: TurnDb, sessionId: string, ownerEmail: string, now = new Date()): Effect.Effect<void, TurnRecordError> {
  const at = now.toISOString();
  return operation("start_turn", () => db.prepare(
    "INSERT INTO turns (session_id, owner_email, started_at, heartbeat_at, tools_running) VALUES (?, ?, ?, ?, 0) ON CONFLICT(session_id) DO UPDATE SET heartbeat_at = excluded.heartbeat_at, tools_running = 0",
  ).bind(sessionId, ownerEmail, at, at).run());
}

export function heartbeatTurnRecord(db: TurnDb, sessionId: string, ownerEmail: string, toolsRunning: number, now = new Date()): Effect.Effect<void, TurnRecordError> {
  return operation("heartbeat_turn", () => db.prepare(
    "UPDATE turns SET heartbeat_at = ?, tools_running = ? WHERE session_id = ? AND owner_email = ?",
  ).bind(now.toISOString(), toolsRunning, sessionId, ownerEmail).run());
}

export function finishTurnRecord(db: TurnDb, sessionId: string, ownerEmail: string): Effect.Effect<void, TurnRecordError> {
  return operation("finish_turn", () => db.prepare(
    "DELETE FROM turns WHERE session_id = ? AND owner_email = ?",
  ).bind(sessionId, ownerEmail).run());
}

export function readTurnRecord(db: TurnDb, sessionId: string, ownerEmail: string): Effect.Effect<TurnRecord | null, TurnRecordError> {
  return operation("read_turn", () => db.prepare(
    "SELECT session_id, owner_email, started_at, heartbeat_at, tools_running FROM turns WHERE session_id = ? AND owner_email = ?",
  ).bind(sessionId, ownerEmail).first<{ session_id: string; owner_email: string; started_at: string; heartbeat_at: string; tools_running: number }>()).pipe(
    Effect.map((row) => row ? { sessionId: row.session_id, ownerEmail: row.owner_email, startedAt: row.started_at, heartbeatAt: row.heartbeat_at, toolsRunning: row.tools_running } : null),
  );
}

export function turnIsLive(db: TurnDb, sessionId: string, ownerEmail: string, now: Date, stallMs: number): Effect.Effect<boolean, TurnRecordError> {
  return Effect.map(readTurnRecord(db, sessionId, ownerEmail), (record) => {
    if (!record) return false;
    return now.getTime() - new Date(record.heartbeatAt).getTime() <= stallMs;
  });
}
