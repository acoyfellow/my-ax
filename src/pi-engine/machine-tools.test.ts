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

test("machinectl tools accept machine and pass it to the runner", async () => {
  const { compile } = await import("@earendil-works/pi-schema");
  const seen: unknown[] = [];
  const runner: MachineToolRunner = { call: async (args) => { seen.push(args); return "{}"; }, code: async (args) => { seen.push(args); return "{}"; } };
  const tools = toolsOf(machineToolsExtension(() => runner)) as Array<{ name: string; parameters: any; execute: (args: any, api: any, context: any) => Promise<any> }>;
  const call = tools.find((tool) => tool.name === "machinectl_call")!;
  const code = tools.find((tool) => tool.name === "machinectl_code")!;
  const callArgs = { tool: "shell", arguments: { command: "uname" }, machine: "air" };
  const codeArgs = { code: "async () => 1", machine: "air" };
  assert.equal(compile(call.parameters).check(callArgs), true);
  assert.equal(compile(code.parameters).check(codeArgs), true);
  assert.equal(compile(call.parameters).check({ tool: "shell", machine: 3 }), false);
  const context = { signal: new AbortController().signal };
  await call.execute(callArgs, {}, context);
  await code.execute(codeArgs, {}, context);
  assert.deepEqual(seen, [callArgs, codeArgs]);
});
