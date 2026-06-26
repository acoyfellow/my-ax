// mcp-code-mode.ts — official Cloudflare Code Mode over selected live MCP tools.
//
// Think remains the authority for MCP OAuth, sessions, discovery, and calls.
// This module selects an exact operator-reviewed subset of the already-hydrated
// catalog and hands ordinary AI SDK tools to @cloudflare/codemode. Every MCP
// tool remains available natively; Code Mode is an additional composition path.

import { DynamicWorkerExecutor, sanitizeToolName } from "@cloudflare/codemode";
import { createCodeTool } from "@cloudflare/codemode/ai";
import { jsonSchema, tool, type Tool, type ToolSet } from "ai";
import { CODE_MODE_EXECUTION_TIMEOUT_MS } from "./code-mode-runtime";
import type { Env } from "./types";
import {
  parseMcpCodeModePolicy,
  selectMcpCodeModeProviders,
  type McpCatalogTool,
} from "./mcp-code-mode-policy";

type McpSource = {
  listTools(): McpCatalogTool[];
  callTool(params: {
    name: string;
    serverId: string;
    arguments?: Record<string, unknown>;
  }): Promise<{ isError?: boolean; content?: Array<{ type: string; text?: string }>; [key: string]: unknown }>;
};

type ServerState = Record<string, { name: string }>;

const MAX_CODE_BYTES = 64 * 1024;

export function createOfficialMcpCodeModeTool(input: {
  env: Env;
  mcp: McpSource;
  servers: ServerState;
}): Tool | null {
  const rawPolicy = input.env.MCP_CODE_MODE_POLICY_JSON;
  const policy = parseMcpCodeModePolicy(rawPolicy);
  if (!policy) {
    if (rawPolicy?.trim()) console.error("mcp_code_mode_policy_invalid");
    return null;
  }

  const selected = selectMcpCodeModeProviders({
    policy,
    catalog: input.mcp.listTools(),
    servers: input.servers,
    sanitize: sanitizeToolName,
  });
  if (!selected) {
    console.error("mcp_code_mode_catalog_collision");
    return null;
  }
  if (selected.length === 0) return null;

  const providers: Array<{ name: string; tools: ToolSet }> = [];
  for (const provider of selected) {
    const tools: ToolSet = {};
    for (const catalogTool of provider.tools) {
      tools[catalogTool.methodName] = tool({
        description: catalogTool.description ?? catalogTool.name,
        inputSchema: jsonSchema<Record<string, unknown>>(
          (catalogTool.inputSchema && typeof catalogTool.inputSchema === "object"
            ? catalogTool.inputSchema
            : { type: "object" }) as Parameters<typeof jsonSchema>[0],
        ),
        execute: async (args) => {
          const result = await input.mcp.callTool({
            serverId: catalogTool.serverId,
            name: catalogTool.name,
            arguments: args ?? {},
          });
          if (result.isError) {
            const text = result.content?.find((item) => item.type === "text")?.text;
            throw new Error(text ?? `${provider.connector}.${catalogTool.name} failed`);
          }
          return result;
        },
      });
    }
    providers.push({ name: provider.providerName, tools });
  }

  const codeTool = createCodeTool({
    tools: providers,
    executor: new DynamicWorkerExecutor({
      loader: input.env.LOADER,
      globalOutbound: null,
      timeout: CODE_MODE_EXECUTION_TIMEOUT_MS,
    }),
    description: [
      "Compose the operator-approved read/query MCP methods in one isolated JavaScript execution.",
      "All MCP methods remain available as native tools; use native tools for writes, approvals, or one simple call.",
      "Write an async arrow function. No network, filesystem, or credentials are exposed.",
      "Available approved methods:",
      "{{types}}",
    ].join("\n\n"),
  });

  const execute = codeTool.execute;
  if (!execute) return null;
  return {
    ...codeTool,
    execute: async (args, options) => {
      const code = typeof (args as { code?: unknown })?.code === "string"
        ? (args as { code: string }).code
        : "";
      if (new TextEncoder().encode(code).byteLength > MAX_CODE_BYTES) {
        throw new Error(`mcp_code_mode code exceeds ${MAX_CODE_BYTES} bytes`);
      }
      return execute(args, options);
    },
  } as Tool;
}
