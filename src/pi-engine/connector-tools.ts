import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, section } from "@earendil-works/pi-durable";
import { awaitWithContext } from "@earendil-works/chord/context";
import { clipToolOutput } from "./workspace-tools";

export type ConnectorRunner = {
  list(): Promise<Array<{ name: string; serverId: string; toolName: string; description: string; inputSchema: unknown }>>;
  call(serverId: string, toolName: string, args: Record<string, unknown>): Promise<string>;
};

export const PI_CONNECTOR_INSTRUCTIONS = "Connectors: the owner's connected MCP servers (Settings → Connectors). Call connector_list to see the tools they publish, then connector_call with {tool, arguments} using a name from that list.";

function textResult(text: string) {
  return { output: [{ type: "text" as const, text: clipToolOutput(text) }] };
}

export function connectorToolsExtension(runner: () => ConnectorRunner) {
  const list = defineTool({
    name: "connector_list",
    description: "List tools published by the owner's connected MCP connectors: name, description and input schema.",
    parameters: Type.Object({ filter: Type.Optional(Type.String({ description: "Only tools whose name or description contains this text" })) }),
    replay: "safe",
    execute: async (args, _api, context) => {
      const filter = (args.filter ?? "").toLowerCase();
      const tools = (await awaitWithContext(runner().list(), context)).filter((tool) => !filter || `${tool.name} ${tool.description}`.toLowerCase().includes(filter));
      return textResult(JSON.stringify(tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }))));
    },
  });
  const call = defineTool({
    name: "connector_call",
    description: "Call one connector tool by the name connector_list returned.",
    parameters: Type.Object({
      tool: Type.String({ description: "Tool name from connector_list" }),
      arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    }),
    execute: async (args, _api, context) => {
      const tools = await awaitWithContext(runner().list(), context);
      const match = tools.find((tool) => tool.name === args.tool);
      if (!match) return textResult(JSON.stringify({ ok: false, error: `unknown connector tool ${args.tool}; call connector_list` }));
      return textResult(await awaitWithContext(runner().call(match.serverId, match.toolName, args.arguments ?? {}), context));
    },
  });
  return defineExtension({ name: "myax.connectors", sections: [section("myax-connectors", () => PI_CONNECTOR_INSTRUCTIONS)], tools: [list, call] });
}
