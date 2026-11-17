import { getAgentByName } from "agents";
import type { UserAgent } from "./user-agent";
import * as rpc from "./rpc/contract";

type LiveEnv = { USER_AGENT?: DurableObjectNamespace<UserAgent> };

export async function announceMachinesChanged(env: LiveEnv, ownerEmail: string): Promise<void> {
  if (!env.USER_AGENT || !ownerEmail || ownerEmail === "unknown") return;
  try {
    const userAgents = env.USER_AGENT;
    await rpc.command("UserAgent.announceMachinesChanged", async () => (await getAgentByName(userAgents, ownerEmail.toLowerCase())).announceMachinesChanged());
  } catch (error) {
    console.warn("machines_live_announce_failed", error instanceof Error ? error.message : String(error));
  }
}
