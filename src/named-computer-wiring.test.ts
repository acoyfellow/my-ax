import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const wrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const index = readFileSync(new URL("./index.tsx", import.meta.url), "utf8");
const tools = readFileSync(new URL("./tools.ts", import.meta.url), "utf8");
const dockerfile = readFileSync(new URL("../Dockerfile.computer", import.meta.url), "utf8");
const named = readFileSync(new URL("./named-computer.ts", import.meta.url), "utf8");
const settings = readFileSync(new URL("./ui/Settings.svelte", import.meta.url), "utf8");
const widgets = readFileSync(new URL("./ui/tool-result-widgets.ts", import.meta.url), "utf8");

test("NamedComputer is a second container class, not the owner Sandbox", () => {
  assert.match(wrangler, /"class_name": "NamedComputer"/);
  assert.match(wrangler, /Dockerfile.computer/);
  assert.match(wrangler, /"name": "NAMED_COMPUTER"/);
  assert.match(index, /export \{ Sandbox as NamedComputer \}/);
  assert.doesNotMatch(named, /idFromName\(key\(identity\)\)/);
  assert.match(named, /computerSandboxName/);
});

test("create_computer and snapshot_computer are Think tools", () => {
  assert.match(tools, /name: "create_computer"/);
  assert.match(tools, /name: "snapshot_computer"/);
  assert.match(tools, /kind: "named-computer"/);
});

test("computers embed through a same-origin screen route and a Settings tab", () => {
  assert.match(index, /registerComputerRoutes/);
  assert.match(settings, /label: "Computers"/);
  assert.match(widgets, /kind: "named-computer"/);
  assert.match(named, /startProcess/);
  assert.match(named, /waitForPort/);
});

test("computer image streams the desktop with voxl instead of noVNC", () => {
  const aptRuns = dockerfile.split("RUN apt-get").length - 1;
  assert.equal(dockerfile.includes("xfce4"), true);
  assert.match(dockerfile, /cargo install --locked voxl-server --version \$\{VOXL_VERSION\}/);
  assert.match(dockerfile, /COPY --from=voxl-build \/opt\/voxl\/bin\/voxl \/usr\/local\/bin\/voxl/);
  assert.equal(/novnc|websockify|tigervnc/.test(dockerfile), false);
  assert.ok(aptRuns >= 2);
  assert.equal(dockerfile.includes("openttd"), false);
});
