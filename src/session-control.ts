import type { AccessIdentity } from "./auth";
import type { Env } from "./types";

export type SessionEngine = "pi" | "think";

export type SessionControl = {
  engine: SessionEngine;
  inject(content: string, clientMsgId: string): Promise<void>;
  abort(): Promise<{ aborted: boolean }>;
  state(): Promise<{ sessionStatus: string; requestId: string | null }>;
};

export async function sessionEngineOf(env: Env, ownerEmail: string, sessionId: string): Promise<SessionEngine> {
  const row = await env.DB.prepare("SELECT engine FROM sessions WHERE id = ? AND owner_email = ?").bind(sessionId, ownerEmail.toLowerCase()).first<{ engine: string | null }>();
  return row?.engine === "pi" ? "pi" : "think";
}

export async function sessionControl(env: Env, identity: AccessIdentity, sessionId: string): Promise<SessionControl> {
  const engine = await sessionEngineOf(env, identity.email, sessionId);
  if (engine === "pi") {
    const { openPiChat } = await import("./pi-engine/routes");
    const chat = await openPiChat(env, identity.email, sessionId);
    return {
      engine,
      inject: async (content, clientMsgId) => { await chat.submitInput(content, [], clientMsgId); },
      abort: async () => { await chat.abortAll(); return { aborted: true }; },
      state: async () => ({ sessionStatus: (await chat.isBusy()) ? "running" : "active", requestId: null }),
    };
  }
  const { getSessionAgent } = await import("./agent-stub");
  const stub = await getSessionAgent(env, identity.email, sessionId);
  await stub.seedIdentity(identity);
  return {
    engine,
    inject: async (content, clientMsgId) => { await stub.injectUserMessage({ content, clientMsgId }); },
    abort: async () => ({ aborted: (await stub.abortActiveTurn()).aborted }),
    state: async () => stub.sessionTurnState(),
  };
}
