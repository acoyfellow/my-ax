import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { computerSandboxName, parseComputerSandboxName } from "./computer-id";

const object = readFileSync(new URL("./named-computer-object.ts", import.meta.url), "utf8");

test("a computer's durable object name gives back its owner and id", () => {
  const name = computerSandboxName("Jordan@Example.com", "assay-probe");
  assert.deepEqual(parseComputerSandboxName(name), { ownerEmail: "jordan@example.com", computerId: "assay-probe" });
  assert.equal(parseComputerSandboxName("jordan@example.com::workspace::x"), null);
  assert.equal(parseComputerSandboxName(null), null);
  assert.equal(parseComputerSandboxName("::computer::x"), null);
});

test("on idle, /home/user is saved to R2 and recorded before the container stops", () => {
  const idle = object.slice(object.indexOf("override async onActivityExpired"));
  assert.match(idle, /await this\.saveHomeOnIdle\(\);\s*await super\.onActivityExpired\(\);/);
  assert.match(object, /this\.createBackup\(computerBackupOptions\(named\.computerId, "idle"\)\)/);
  assert.match(object, /saveComputerSnapshot\(.*, named\.ownerEmail, named\.computerId, backup\.id, backup\.dir\)/);
});

test("a failed idle save is logged and never blocks the stop", () => {
  assert.match(object, /named_computer\.idle_save_failed/);
  assert.match(object, /return "failed";/);
});
