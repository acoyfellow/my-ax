import { Agent } from "agents";
import type { AccessIdentity } from "./auth";
import type { ConnectorExploreResult } from "./connector-explore";
import { makeOAuthClientStore } from "./oauth-store";
import { healthFromDiscovery, summarizeConnectorError, type ConnectorHealth } from "./connector-health";
import { getBuiltinConnectors } from "./connectors";
import { resolveBridgeOrigin } from "./bridge-origin";
import { safePublicHttpUrl } from "./public-url";
import type { Env } from "./types";

type ConnectorAgentState = { identity?: AccessIdentity };

export class ConnectorAgent extends Agent<Env, ConnectorAgentState> {
  initialState: ConnectorAgentState = {};

  async seedIdentity(identity: AccessIdentity): Promise<void> {
    if (this.state.identity?.email !== identity.email) this.setState({ identity });
  }

  private identity(): AccessIdentity | undefined {
    return this.state.identity;
  }

  private async ensureNativeMcp(): Promise<void> {
    const identity = this.identity();
    if (!identity) return;
    try {
      await this.hydrateNativeMcp(identity);
    } catch (err) {
      console.error("native_mcp_hydration_failed", { err: err instanceof Error ? err.message : String(err) });
    }
  }

  private async hydrateNativeMcp(identity: AccessIdentity): Promise<void> {
    const workerOrigin = resolveBridgeOrigin(this.env.BRIDGE_BASE_URL);
    if (!workerOrigin) {
      console.error("native_mcp_hydration_skipped_invalid_bridge_base_url", { bridgeBaseUrl: this.env.BRIDGE_BASE_URL ? "set" : "empty" });
      return;
    }
    const store = makeOAuthClientStore(this.env.OAUTH_CLIENT, workerOrigin);
    const register = async (id: string, upstream: string) => {
      const existingEntry = Object.entries(this.getMcpServers().servers).find(([, server]) => server.name === id);
      const token = await store.getValidAccessToken(identity.email, id).catch(() => null);
      if (!token) {
        if (existingEntry) await this.mcp.removeServer(existingEntry[0]).catch(() => undefined);
        return;
      }
      const recordHealth = (health: ConnectorHealth) =>
        store.recordConnectorHealth(identity.email, id, health).catch((err) => {
          console.error("mcp_health_record_failed", { server: id, err: summarizeConnectorError(err) });
        });
      const toolCountFor = (serverId: string) => this.mcp.listTools().filter((catalogTool) => catalogTool.serverId === serverId).length;
      if (existingEntry) {
        const discovered = toolCountFor(existingEntry[0]) > 0;
        if (discovered) return;
        await this.mcp.removeServer(existingEntry[0]).catch(() => undefined);
      }
      if (!safePublicHttpUrl(upstream, { httpsOnly: true })) {
        console.error("mcp_hydrate_skipped_invalid_upstream", { server: id });
        await recordHealth({ outcome: "failed", error: "upstream URL is not a public https URL", checkedAt: new Date().toISOString() });
        return;
      }
      try {
        const result = await this.addMcpServer(id, upstream, {
          id,
          transport: { type: "streamable-http", headers: { Authorization: `Bearer ${token}` } },
        });
        const checkedAt = new Date().toISOString();
        if (result.state === "authenticating") {
          await recordHealth({ outcome: "failed", error: "upstream asked for a new sign-in", checkedAt });
        } else {
          await recordHealth(healthFromDiscovery(toolCountFor(result.id), checkedAt));
        }
      } catch (err) {
        const error = summarizeConnectorError(err);
        console.error("mcp_hydrate_failed", { server: id, err: error });
        await recordHealth({ outcome: "failed", error, checkedAt: new Date().toISOString() });
      }
    };
    const configured = Object.values(getBuiltinConnectors(this.env));
    try { configured.push(...await store.listUserMcps(identity.email)); }
    catch (err) { console.error("mcp_list_user_mcps_failed", { err: err instanceof Error ? err.message : String(err) }); }
    const configuredIds = new Set(configured.map((mcp) => mcp.id));
    for (const [serverId, server] of Object.entries(this.getMcpServers().servers)) {
      if (!configuredIds.has(server.name)) await this.mcp.removeServer(serverId).catch(() => undefined);
    }
    for (const mcp of configured) await register(mcp.id, mcp.upstream);
  }

  async connectorCatalog(): Promise<Array<{ name: string; serverId: string; toolName: string; description: string; inputSchema: unknown }>> {
    await this.ensureNativeMcp();
    const servers = this.getMcpServers().servers;
    return this.mcp.listTools().map((catalogTool) => ({
      name: `${(servers[catalogTool.serverId]?.name ?? catalogTool.serverId).replace(/[^a-zA-Z0-9_]/g, "_")}__${catalogTool.name}`.slice(0, 64),
      serverId: catalogTool.serverId,
      toolName: catalogTool.name,
      description: String(catalogTool.description ?? catalogTool.name),
      inputSchema: catalogTool.inputSchema ?? { type: "object", properties: {} },
    }));
  }

  async connectorExplore(): Promise<ConnectorExploreResult> {
    await this.ensureNativeMcp();
    const servers = this.getMcpServers().servers;
    const nameOf = (serverId: string) => servers[serverId]?.name ?? serverId;
    const group = <T extends { serverId: string }>(items: T[]) => {
      const byServer: Record<string, T[]> = {};
      for (const item of items) (byServer[nameOf(item.serverId)] ??= []).push(item);
      return byServer;
    };
    const tools = group(this.mcp.listTools().map((tool) => ({ serverId: tool.serverId, name: tool.name, description: String(tool.description ?? ""), inputSchema: tool.inputSchema ?? { type: "object", properties: {} } })));
    const resources = group(this.mcp.listResources().map((resource) => ({ serverId: resource.serverId, uri: String(resource.uri), name: String(resource.name ?? resource.uri), description: String(resource.description ?? ""), mimeType: resource.mimeType ? String(resource.mimeType) : null })));
    const prompts = group(this.mcp.listPrompts().map((prompt) => ({ serverId: prompt.serverId, name: prompt.name, description: String(prompt.description ?? ""), arguments: (prompt.arguments ?? []).map((argument) => ({ name: argument.name, description: String(argument.description ?? ""), required: Boolean(argument.required) })) })));
    const serverIdByName: Record<string, string> = {};
    for (const [serverId, server] of Object.entries(servers)) serverIdByName[server.name] = serverId;
    return { servers: Object.entries(servers).map(([serverId, server]) => ({ id: server.name, serverId, state: String(server.state), error: server.error ? String(server.error) : null })), tools, resources, prompts, serverIdByName };
  }

  async connectorCallByName(serverName: string, toolName: string, args: Record<string, unknown>): Promise<string> {
    await this.ensureNativeMcp();
    const serverId = Object.entries(this.getMcpServers().servers).find(([, server]) => server.name === serverName)?.[0];
    if (!serverId) throw new Error(`MCP "${serverName}" is not connected`);
    return this.connectorCall(serverId, toolName, args);
  }

  async connectorCall(serverId: string, toolName: string, args: Record<string, unknown>): Promise<string> {
    await this.ensureNativeMcp();
    const result = await this.mcp.callTool({ serverId, name: toolName, arguments: args });
    return JSON.stringify(result);
  }

}
