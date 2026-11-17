import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { pairCommandFor } from "./machines-panel";

const settings = readFileSync(new URL("./Settings.svelte", import.meta.url), "utf8");
const panel = readFileSync(new URL("./MachinesPanel.svelte", import.meta.url), "utf8");
const pair = { code: "ABCD-EFGH", expiresAt: 0, origin: "https://my.ax.example" };

test("the pair command installs machinectl once, then pairs with the code and this origin", () => {
  const command = pairCommandFor(pair, "");
  assert.match(command, /\[ -d ~\/machinectl \] \|\| git clone https:\/\/github\.com\/acoyfellow\/machinectl\.git ~\/machinectl/);
  assert.match(command, /node dist\/index\.js pair ABCD-EFGH --url 'https:\/\/my\.ax\.example'$/);
});

test("a typed name becomes a safe machine name flag, and shell characters cannot escape", () => {
  assert.match(pairCommandFor(pair, " Work Laptop "), /--name 'work-laptop'$/);
  assert.match(pairCommandFor(pair, "a'; rm -rf ~"), /--name 'a-rm-rf'$/);
});

test("Machines sit at the top of Connections, with add, rename and remove", () => {
  const connections = settings.slice(settings.indexOf('hidden={activeSection !== "connections"}'));
  assert.match(connections.slice(0, 300), /<MachinesPanel active=\{open && activeSection === "connections"\} \/>/);
  assert.match(panel, /fetch\("\/api\/machines\/pair-codes", \{ method: "POST"/);
  assert.match(panel, /method: "PATCH"[^\n]*JSON\.stringify\(\{ title \}\)/);
  assert.match(panel, /method: "DELETE"/);
});
