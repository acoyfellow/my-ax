import type { Env } from "./types";
import { getSessionAgent } from "./agent-stub";
import { notifyOwner } from "./notify";
import { DEAD_SESSION_ATTENTION_KIND, runDeadSessionScan, type DeadSessionDeps } from "./dead-session-detector";

export { DEAD_SESSION_STALL_MS, detectDeadSession } from "./dead-session-detector";
export { DEAD_SESSION_ATTENTION_KIND } from "./dead-session-detector";

export function makeDeadSessionDeps(env: Env): DeadSessionDeps {
  return {
    reviveTurn: async (ownerEmail, sessionId, message, clientMsgId) => {
      const stub = await getSessionAgent(env, ownerEmail, sessionId);
      await stub.seedIdentity({ email: ownerEmail, sub: "system:auto-revive" });
      await stub.injectUserMessage({ content: message, clientMsgId });
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

export async function scanDeadSessions(env: Env, now = new Date()): Promise<void> {
  await runDeadSessionScan(env.DB as never, makeDeadSessionDeps(env), now);
}
