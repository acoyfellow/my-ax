import { Effect } from "effect";
import type { Env } from "./types";
import { openPiChat } from "./pi-engine/routes";
import { applySessionEvent } from "./fsm/session-status";
import * as rpc from "./rpc/contract";
import { notifyOwner } from "./notify";
import { DEAD_SESSION_ATTENTION_KIND } from "./dead-session-detector";
import { runDeadSessionScan, type DeadSessionDeps } from "./dead-session-program";

export { DEAD_SESSION_STALL_MS, detectDeadSession } from "./dead-session-detector";
export { DEAD_SESSION_ATTENTION_KIND } from "./dead-session-detector";

export function makeDeadSessionDeps(env: Env): DeadSessionDeps {
  return {
    reviveTurn: async (ownerEmail, sessionId, message, clientMsgId) => {
      const { sessionControl } = await import("./session-control");
      await (await sessionControl(env, { email: ownerEmail, sub: "system:auto-revive" } as Parameters<typeof sessionControl>[1], sessionId)).inject(message, clientMsgId);
    },
    hasLiveTurn: async (ownerEmail, sessionId) => {
      return await rpc.command("PiChat.isBusy", async () => (await openPiChat(env, ownerEmail, sessionId)).isBusy());
    },
    settleRunningWithoutTurn: async (ownerEmail, sessionId) => {
      const busy = await rpc.command("PiChat.isBusy", async () => (await openPiChat(env, ownerEmail, sessionId)).isBusy());
      if (busy) return;
      await applySessionEvent(env.DB, { id: sessionId, ownerEmail: ownerEmail.toLowerCase() }, "turn_stuck");
    },
    alertOwner: async (ownerEmail, sessionId, dedupeSuffix) => {
      await notifyOwner(env, ownerEmail, {
        kind: DEAD_SESSION_ATTENTION_KIND,
        title: "Session needs attention",
        body: "A conversation stopped before replying and its automatic retry did not recover it.",
        href: `/?session=${encodeURIComponent(sessionId)}`,
        sessionId,
        dedupeKey: `session-dead:${sessionId}:${dedupeSuffix}`,
      });
    },
  };
}

export function scanDeadSessions(env: Env, now = new Date()): Promise<void> {
  return Effect.runPromise(runDeadSessionScan(env.DB as never, makeDeadSessionDeps(env), now));
}
