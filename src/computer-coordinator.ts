import { COMPUTER_EXEC_TOOL, COMPUTER_INPUT_TOOL, COMPUTER_SCREENSHOT_TOOL, COMPUTER_WAIT_TOOL } from "./computer-screen-tools";
import { CREATE_COMPUTER_TOOL } from "./tools";
import type { AccessIdentity } from "./auth";
import type { Env, ToolContext, ToolDef } from "./types";

const COMPUTER_TOOLS: Record<string, ToolDef> = {
  computer_create: CREATE_COMPUTER_TOOL,
  computer_exec: COMPUTER_EXEC_TOOL,
  computer_input: COMPUTER_INPUT_TOOL,
  computer_screenshot: COMPUTER_SCREENSHOT_TOOL,
  computer_wait: COMPUTER_WAIT_TOOL,
};

export function isComputerMethod(method: string): boolean {
  return Object.hasOwn(COMPUTER_TOOLS, method);
}

export async function runComputerMethod(env: Env, identity: AccessIdentity, method: string, args: Record<string, unknown>): Promise<unknown> {
  const tool = COMPUTER_TOOLS[method];
  if (!tool) throw new Error(`unknown computer method ${method}`);
  const context = { env, identity } as unknown as ToolContext;
  return JSON.parse(await tool.execute(args, context) as string);
}
