import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { addMachineCommand, machineStatusLine, type PairedMachine } from "./machines-panel";

const settings = readFileSync(new URL("./Settings.svelte", import.meta.url), "utf8");
const panel = readFileSync(new URL("./MachinesPanel.svelte", import.meta.url), "utf8");
const origin = "https://my.ax.example";

test("adding a machine signs in with the normal login, with no code and no bypass", () => {
  const command = addMachineCommand(origin, "", false);
  assert.match(command, /git clone https:\/\/github\.com\/acoyfellow\/machinectl\.git ~\/machinectl/);
  assert.match(command, /cloudflared access login 'https:\/\/my\.ax\.example'/);
  assert.match(command, /node dist\/index\.js install-agent --url 'https:\/\/my\.ax\.example'$/);
  assert.doesNotMatch(command, /pair|--shell/);
});

test("terminal access is opt-in, and a typed name becomes a safe slug", () => {
  assert.match(addMachineCommand(origin, " Work Laptop ", true), /--name 'work-laptop' --shell$/);
  assert.match(addMachineCommand(origin, "a'; rm -rf ~", false), /--name 'a-rm-rf'$/);
  assert.match(panel, /let allowShell = \$state\(false\)/);
});

test("each state says plainly what the machine can do", () => {
  const base: PairedMachine = { name: "air", title: "Air", state: "approved", hostName: "air.local", createdAt: 0, lastSeenAt: 0, connected: true, tools: ["shell", "screenshot"] };
  assert.equal(machineStatusLine(base), "Connected · air.local · 2 tools");
  assert.match(machineStatusLine({ ...base, state: "pending", connected: false }), /approval/);
  assert.match(machineStatusLine({ ...base, state: "logged_out", connected: false }), /Logged out/);
  assert.equal(machineStatusLine({ ...base, connected: false }), "Approved · offline");
});

test("the Machines panel sits under Connections with approve, log out, log out all and rename", () => {
  const connections = settings.slice(settings.indexOf('hidden={activeSection !== "connections"}'));
  assert.match(connections.slice(0, 300), /<MachinesPanel active=\{open && activeSection === "connections"\} \/>/);
  assert.match(panel, /\/api\/machines\/\$\{encodeURIComponent\(machine\.name\)\}\/approve/);
  assert.match(panel, /\/api\/machines\/\$\{encodeURIComponent\(machine\.name\)\}\/logout/);
  assert.match(panel, /"\/api\/machines\/logout-all"/);
  assert.match(panel, /method: "PATCH"[^\n]*JSON\.stringify\(\{ title \}\)/);
  assert.doesNotMatch(panel, /pair-codes/);
});
