import { Data, Effect } from "effect";
import {
  AUTO_REVIVE_PREFIX,
  DEAD_SESSION_ATTENTION_KIND,
  DEAD_SESSION_STALL_MS,
  deadSessionRecoveryPlan,
  detectDeadSession,
  isDeadSessionAttentionForCurrentTurn,
  type RecentConversationEntry,
} from "./dead-session-detector";

export interface DeadSessionDb {
  prepare(sql: string): {
    bind(...binds: unknown[]): {
      all<T = unknown>(): Promise<{ results?: T[] }>;
      first<T = unknown>(): Promise<T | null>;
      run(): Promise<unknown>;
    };
  };
}

export interface DeadSessionDeps {
  reviveTurn: (ownerEmail: string, sessionId: string, message: string, clientMsgId: string) => Promise<void>;
  alertOwner: (ownerEmail: string, sessionId: string, dedupeSuffix: number) => Promise<void>;
}

type DeadSessionRow = { id: string; owner_email: string; updated_at: string };

class DeadSessionOperationError extends Data.TaggedError("DeadSessionOperationError")<{
  operation: string;
  cause: unknown;
}> {}

function operation<A>(name: string, run: () => Promise<A>): Effect.Effect<A, DeadSessionOperationError> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new DeadSessionOperationError({ operation: name, cause }),
  });
}

function scanSession(
  db: DeadSessionDb,
  deps: DeadSessionDeps,
  session: DeadSessionRow,
  now: Date,
  stallMs: number,
): Effect.Effect<void, DeadSessionOperationError | Error> {
  return Effect.gen(function* () {
    const ownerEmail = session.owner_email?.trim().toLowerCase();
    if (!ownerEmail) return yield* Effect.fail(new Error("session owner is missing"));
    const recent = yield* operation("load_recent_entries", () => db.prepare(
      `SELECT id, ts, role, content, meta_json FROM (
        SELECT id, ts, role, content, meta_json FROM conversation_entries
        WHERE session_id = ? AND owner_email = ? ORDER BY id DESC LIMIT 12
      ) ORDER BY id ASC`,
    ).bind(session.id, ownerEmail).all<RecentConversationEntry>());
    const dead = detectDeadSession(recent.results ?? [], session.updated_at, now, stallMs);
    if (!dead) return;

    const latestUserEntry = (recent.results ?? []).find((entry) => entry.id === dead.latestUserEntryId);
    if (!latestUserEntry) return;
    const incident = deadSessionRecoveryPlan(latestUserEntry);
    if (incident.action === "retry_silently") {
      yield* operation("revive_turn", () => deps.reviveTurn(
        ownerEmail,
        session.id,
        dead.latestUserMessage,
        `${AUTO_REVIVE_PREFIX}${incident.originalUserEntryId}`,
      ));
      return;
    }

    const latestUserCreatedAt = latestUserEntry.ts ?? session.updated_at;
    const priorAttention = yield* operation("load_prior_attention", () => db.prepare(
      "SELECT id, created_at FROM attention_items WHERE owner_email = ? AND session_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1",
    ).bind(ownerEmail, session.id, DEAD_SESSION_ATTENTION_KIND).first<{ id: string; created_at: string }>());
    const attention = priorAttention && isDeadSessionAttentionForCurrentTurn(priorAttention.created_at, latestUserCreatedAt)
      ? priorAttention
      : null;
    if (!attention) {
      yield* operation("alert_owner", () => deps.alertOwner(ownerEmail, session.id, incident.originalUserEntryId));
    }
    yield* operation("interrupt_session", () => db.prepare(
      "UPDATE sessions SET status = 'interrupted', updated_at = updated_at WHERE id = ? AND owner_email = ? AND status IN ('active', 'running')",
    ).bind(session.id, ownerEmail).run());
  });
}

export function runDeadSessionScan(
  db: DeadSessionDb,
  deps: DeadSessionDeps,
  now: Date,
  stallMs = DEAD_SESSION_STALL_MS,
): Effect.Effect<void, DeadSessionOperationError> {
  const cutoff = new Date(now.getTime() - stallMs).toISOString();
  return Effect.gen(function* () {
    const sessions = yield* operation("list_stalled_sessions", () => db.prepare(
      "SELECT id, owner_email, updated_at FROM sessions WHERE status IN ('active', 'running') AND updated_at < ? ORDER BY updated_at ASC, id ASC LIMIT 50",
    ).bind(cutoff).all<DeadSessionRow>());
    yield* Effect.forEach(
      sessions.results ?? [],
      (session) => scanSession(db, deps, session, now, stallMs).pipe(
        Effect.catch((error) => Effect.sync(() => {
          console.error("dead_session_scan_failed", {
            sessionId: session.id,
            ownerEmail: session.owner_email,
            error: error instanceof Error ? error.message : String(error),
          });
        })),
      ),
      { concurrency: 1, discard: true },
    );
  });
}
