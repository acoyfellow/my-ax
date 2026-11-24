import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { codeUsesMachine, machineChoiceSummary, requestedMachine } from "./machine-choice";
import { chooseMachine, type OnlineMachine } from "./machine-target";

const online = (name: string): OnlineMachine => ({ name, title: name, slot: name, status: { connected: true } as OnlineMachine["status"] });

test("machine choice says which machine was picked, or why none was", () => {
  assert.deepEqual(machineChoiceSummary(chooseMachine([online("air")], undefined)), { ok: true, machine: "air", online: ["air"] });
  const ambiguous = machineChoiceSummary(chooseMachine([online("air"), online("work")], undefined));
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.ok === false && ambiguous.reason, "ambiguous");
  assert.deepEqual(ambiguous.online, ["air", "work"]);
  assert.deepEqual(machineChoiceSummary(chooseMachine([online("air"), online("work")], "work")), { ok: true, machine: "work", online: ["air", "work"] });
});

test("only code that touches the machine namespace is refused when the machine is ambiguous", () => {
  assert.equal(codeUsesMachine("async () => machine.shell({ command: 'ls' })"), true);
  assert.equal(codeUsesMachine("async () => machine?.shell({})"), true);
  assert.equal(codeUsesMachine("async () => machine_shell({})"), true);
  assert.equal(codeUsesMachine("async () => workspace.exec({ command: 'ls' })"), false);
  assert.equal(codeUsesMachine("async () => 'a machine learning note'"), false);
});

test("work_code and work_search accept a machine and pass it on", () => {
  assert.equal(requestedMachine(" work "), "work");
  assert.equal(requestedMachine(""), undefined);
  assert.equal(requestedMachine(3), undefined);
  const source = readFileSync(new URL("./work-tools.ts", import.meta.url), "utf8");
  for (const name of ["work_search", "work_code"]) {
    const block = source.slice(source.indexOf(`name: "${name}"`), source.indexOf("execute:", source.indexOf(`name: "${name}"`)));
    assert.match(block, /machine: \{ type: "string"/, name);
  }
  assert.match(source, /createMachineWorkProvider\(ctx, requestedMachine\(args\.machine\)\)/);
  assert.match(source, /createMachineWorkProvider\(executionContext, machineName\)/);
  assert.match(source, /executeWorkCode\(typeof args\.code === "string" \? args\.code : "", ctx, requestedMachine\(args\.machine\)\)/);
});
