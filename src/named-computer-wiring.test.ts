import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const wrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const index = readFileSync(new URL("./index.tsx", import.meta.url), "utf8");
const tools = readFileSync(new URL("./tools.ts", import.meta.url), "utf8");
const dockerfile = readFileSync(new URL("../Dockerfile.computer", import.meta.url), "utf8");
const named = readFileSync(new URL("./named-computer.ts", import.meta.url), "utf8");

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
});

test("computer image splits desktop and vnc into separate apt layers", () => {
  const xfce = dockerfile.includes("xfce4");
  const novnc = dockerfile.includes("novnc");
  const aptRuns = dockerfile.split("RUN apt-get").length - 1;
  assert.equal(xfce, true);
  assert.equal(novnc, true);
  assert.ok(aptRuns >= 2);
  assert.equal(dockerfile.includes("openttd"), false);
});
