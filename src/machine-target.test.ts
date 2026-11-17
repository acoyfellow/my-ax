import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { chooseMachine, machineSlot, type OnlineMachine } from "./machine-target";

const online = (name: string, title = name): OnlineMachine => ({ name, title, slot: machineSlot(name), status: { connected: true, tools: [] } });

test("with one machine online the agent uses it without naming it", () => {
  const target = chooseMachine([online("air")], undefined);
  assert.equal(target.ok && target.machine.name, "air");
});

test("with several online the agent must name one, by name or by title", () => {
  const machines = [online("air", "Jordan's Air"), online("work", "Work")];
  const unnamed = chooseMachine(machines, undefined);
  assert.equal(unnamed.ok, false);
  assert.equal(!unnamed.ok && unnamed.reason, "ambiguous");
  assert.match(!unnamed.ok ? unnamed.message : "", /air \(Jordan's Air\), work \(Work\)/);
  const byName = chooseMachine(machines, "work");
  assert.equal(byName.ok && byName.machine.name, "work");
  const byTitle = chooseMachine(machines, "jordan's air");
  assert.equal(byTitle.ok && byTitle.machine.name, "air");
});

test("asking for a machine that is not online says which ones are", () => {
  const target = chooseMachine([online("air")], "work");
  assert.equal(!target.ok && target.reason, "unknown");
  assert.match(!target.ok ? target.message : "", /Online: air/);
  assert.equal(chooseMachine([], undefined).ok, false);
});

test("the old single-slot machine keeps its storage slot as default", () => {
  assert.equal(machineSlot("default"), undefined);
  assert.equal(machineSlot("air"), "air");
});

test("the Physical laptop card is gone and agent tools resolve through the machine list", () => {
  const connectors = readFileSync(new URL("./ui/Connectors.svelte", import.meta.url), "utf8");
  const tools = readFileSync(new URL("./routes/machinectl.ts", import.meta.url), "utf8");
  assert.doesNotMatch(connectors, /Physical laptop|laptop-row/);
  assert.doesNotMatch(tools, /function hostFor|readMachineStatus\(/);
  assert.match(tools, /resolveMachine\(/);
  assert.match(tools, /machine: \{ type: "string", description: "Which machine to use/);
});
