// agent-stub.ts — resolve a conversation MyAgent facet inside one per-user
// UserAgent root DO. Callers outside the DO use RPC (not facet.fetch()).

import { getAgentByName } from "agents";
import type { Env } from "./types";
import type { AccessIdentity } from "./auth";
import { resolveStub } from "./rpc/bounded-stub";

export async function getUserAgent(env: Pick<Env, "USER_AGENT">, ownerEmail: string) {
  return resolveStub("UserAgent.init", () => getAgentByName(env.USER_AGENT, ownerEmail.toLowerCase()));
}

type ConnectorEnv = { CONNECTOR_AGENT: DurableObjectNamespace<import("./connector-agent").ConnectorAgent> };

export async function getConnectorAgent(env: Env, identity: AccessIdentity) {
  const stub = await resolveStub("ConnectorAgent.init", () => getAgentByName((env as unknown as ConnectorEnv).CONNECTOR_AGENT, identity.email.toLowerCase()));
  await stub.seedIdentity(identity);
  return stub;
}
