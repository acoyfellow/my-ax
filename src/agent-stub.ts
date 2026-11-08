// agent-stub.ts — resolve a conversation MyAgent facet inside one per-user
// UserAgent root DO. Callers outside the DO use RPC (not facet.fetch()).

import { getAgentByName, getSubAgentByName } from "agents";
import { MyAgent } from "./agent";
import type { Env } from "./types";
import { resolveStub } from "./rpc/bounded-stub";

export async function getUserAgent(env: Pick<Env, "USER_AGENT">, ownerEmail: string) {
  return resolveStub("UserAgent.init", () => getAgentByName(env.USER_AGENT, ownerEmail.toLowerCase()));
}

export async function getSessionAgent(env: Env, ownerEmail: string, sessionId: string) {
  const parent = await getUserAgent(env, ownerEmail);
  return resolveStub("MyAgent.facet", () => getSubAgentByName(parent, MyAgent, sessionId));
}
