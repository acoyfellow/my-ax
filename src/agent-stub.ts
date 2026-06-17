// agent-stub.ts — resolve a conversation MyAgent facet inside one per-user
// UserAgent root DO. Callers outside the DO use RPC (not facet.fetch()).

import { getAgentByName, getSubAgentByName } from "agents";
import { MyAgent } from "./agent";
import type { Env } from "./types";

export async function getSessionAgent(env: Env, ownerEmail: string, sessionId: string) {
  const parent = await getAgentByName(env.USER_AGENT, ownerEmail.toLowerCase());
  return getSubAgentByName(parent, MyAgent, sessionId);
}
