import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, section } from "@earendil-works/pi-durable";
import { awaitWithContext } from "@earendil-works/chord/context";
import { clipToolOutput } from "./workspace-tools";

/**
 * My Machine for Pi engine chats.
 *
 * Old-engine (Think) chats reach the user's connected machine (machinectl
 * companion, including the cmux / Pi session controls) through
 * machinectl_call and machinectl_code. Pi engine chats only had the chat
 * sandbox tools, so since new chats moved to the Pi engine (#316) the agent
 * could not see or steer a local cmux Pi session at all. This extension gives
 * Pi chats the same two tools, backed by the same implementation.
 */
export type MachineToolRunner = {
  call(args: { tool: string; arguments?: Record<string, unknown> }): Promise<string>;
  code(args: { code: string }): Promise<string>;
};

export const PI_MACHINE_INSTRUCTIONS = [
  "My Machine: when the user asks about their own computer, a terminal, cmux, or a Pi session running locally, use machinectl_call and machinectl_code. They run on the user's connected machine, not this chat's sandbox.",
  "Start with machinectl_call { tool: \"tools/list\" } to see whether a machine is connected and which tools it publishes. For cmux and Pi sessions prefer the cmux_workspace_* and cmux_pi_* tools (list, tail, prompt, steer, abort). Never claim the machine is unreachable without checking tools/list first.",
].join("\n");

function textResult(text: string) {
  return { content: [{ type: "text" as const, text: clipToolOutput(text) }] };
}

export function machineToolsExtension(runner: () => MachineToolRunner) {
  const call = defineTool({
    name: "machinectl_call",
    description: "Discover or directly invoke a tool on the user's connected machine. Use { tool: \"tools/list\" } first to see what is connected. Core tools are shell, screenshot, mouse, keyboard and input_sequence. When published, cmux_* tools list cmux workspaces, tail Pi terminals, and prompt, steer or abort a live Pi session.",
    parameters: Type.Object({
      tool: Type.String({ description: "Machine tool name, or tools/list for discovery." }),
      arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Arguments for the machine tool." })),
    }),
    execute: async (args, _api, context) => textResult(await awaitWithContext(runner().call(args), context)),
  });
  const code = defineTool({
    name: "machinectl_code",
    description: "Run a JavaScript async arrow function against the user's connected machine via isolated Code Mode, calling codemode.<machine_tool>(args). Use it to batch several machine calls, such as finding a cmux surface and then prompting its Pi session.",
    parameters: Type.Object({
      code: Type.String({ description: "JavaScript async arrow function using codemode.<machine_tool>(args)." }),
    }),
    execute: async (args, _api, context) => textResult(await awaitWithContext(runner().code(args), context)),
  });
  return defineExtension({ name: "myax.machine", sections: [section("myax-machine", () => PI_MACHINE_INSTRUCTIONS)], tools: [call, code] });
}
