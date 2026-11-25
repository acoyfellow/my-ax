import { unsafe } from "@earendil-works/pi-schema";
import { defineExtension, defineTool, section } from "@earendil-works/pi-durable";
import { awaitWithContext } from "@earendil-works/chord/context";
import type { ConnectorRunner } from "./connector-tools";
import { clipToolOutput } from "./workspace-tools";

export type CatalogTool = Awaited<ReturnType<ConnectorRunner["list"]>>[number];

export const MCP_EXTENSION_NAME = "myax.mcp";
export const MCP_TOOL_NAME_LIMIT = 64;
export const PI_MCP_INSTRUCTIONS = "MCP servers: the owner's connectors (Settings → Connectors) give you tools named mcp__<server>__<tool>. They are not offered up front. Call tool_search with what you need, for example \"jira issue\" or \"github pull request\", and the matching tools are offered from your next call. Then call them directly.";

const SAFE_NAME = /[^a-zA-Z0-9_]/g;

export function mcpServerName(tool: CatalogTool): string {
  const suffix = `__${tool.toolName}`;
  const fromName = tool.name.endsWith(suffix) ? tool.name.slice(0, -suffix.length) : "";
  return fromName || tool.serverId;
}

function shortHash(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36);
}

export function mcpToolName(server: string, tool: string): string {
  const name = `mcp__${server.replace(SAFE_NAME, "_")}__${tool.replace(SAFE_NAME, "_")}`;
  if (name.length <= MCP_TOOL_NAME_LIMIT) return name;
  const hash = shortHash(name);
  return `${name.slice(0, MCP_TOOL_NAME_LIMIT - hash.length - 1)}_${hash}`;
}

export function mcpInputSchema(schema: unknown): Record<string, unknown> {
  if (schema && typeof schema === "object" && !Array.isArray(schema) && (schema as { type?: unknown }).type === "object") return schema as Record<string, unknown>;
  return { type: "object", properties: {} };
}

export function catalogToolEntries(catalog: readonly CatalogTool[]): Array<{ name: string; tool: CatalogTool }> {
  const seen = new Set<string>();
  const entries: Array<{ name: string; tool: CatalogTool }> = [];
  for (const tool of catalog) {
    const name = mcpToolName(mcpServerName(tool), tool.toolName);
    if (seen.has(name)) continue;
    seen.add(name);
    entries.push({ name, tool });
  }
  return entries;
}

function textResult(text: string) {
  return { output: [{ type: "text" as const, text: clipToolOutput(text) }] };
}

export function mcpToolsExtension(catalog: readonly CatalogTool[], runner: () => ConnectorRunner) {
  const tools = catalogToolEntries(catalog).map(({ name, tool }) => defineTool({
    name,
    description: `${mcpServerName(tool)} (MCP): ${tool.description}`.slice(0, 1024),
    parameters: unsafe<Record<string, unknown>>(mcpInputSchema(tool.inputSchema) as never),
    deferred: true,
    execute: async (args, api, context) => {
      const startedAt = Date.now();
      const callId = crypto.randomUUID();
      const activeRunner = runner();
      const onAbort = () => { void activeRunner.cancel?.(callId).catch(() => undefined); };
      context.abortSignal?.addEventListener("abort", onAbort, { once: true });
      try {
        return textResult(await awaitWithContext(activeRunner.call(tool.serverId, tool.toolName, (args ?? {}) as Record<string, unknown>, { callId }), context));
      } catch (error) {
        if (context.abortSignal?.aborted) {
          const note = `Killed by owner after ${((Date.now() - startedAt) / 1000).toFixed(1)}s (${name}). Cancel sent to MCP server; verify side effects before retrying.`;
          api.output(`${note}\n`);
        }
        throw error;
      } finally {
        context.abortSignal?.removeEventListener("abort", onAbort);
      }
    },
  }));
  return defineExtension({ name: MCP_EXTENSION_NAME, sections: tools.length ? [section("myax-mcp", () => PI_MCP_INSTRUCTIONS)] : [], tools });
}
