import { test } from "node:test";
import assert from "node:assert/strict";
import { machineToolsExtension, PI_MACHINE_INSTRUCTIONS, type MachineToolRunner } from "./machine-tools";

function toolsOf(extension: unknown): Array<{ name: string; execute: (args: any, api: any, context: any) => Promise<any> }> {
  const value = extension as { tools?: unknown; definition?: { tools?: unknown } };
  const tools = (value.tools ?? value.definition?.tools) as Array<any> | undefined;
  assert.ok(Array.isArray(tools), "extension exposes its tools");
  return tools;
}

test("pi chats get the same machinectl tools as old-engine chats", () => {
  const runner: MachineToolRunner = { call: async () => "{}", code: async () => "{}" };
  const names = toolsOf(machineToolsExtension(() => runner)).map((tool) => tool.name).sort();
  assert.deepEqual(names, ["machinectl_call", "machinectl_code"]);
});

test("instructions point the agent at cmux Pi tools and tools/list before giving up", () => {
  assert.match(PI_MACHINE_INSTRUCTIONS, /tools\/list/);
  assert.match(PI_MACHINE_INSTRUCTIONS, /cmux_pi_/);
});
