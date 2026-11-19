import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runningProcessCheck } from "./named-computer";

test("the display check finds a process the sandbox SDK did not start", () => {
  const command = runningProcessCheck("Xvfb");
  assert.equal(command, "cat /proc/[0-9]*/comm 2>/dev/null | grep -q '^Xvfb'");
});

test("the display check refuses names that could change the shell command", () => {
  assert.throws(() => runningProcessCheck("voxl "), /unsafe process name/);
  assert.throws(() => runningProcessCheck("x'; rm -rf /"), /unsafe process name/);
});

test("the check does not match its own grep", { skip: process.platform !== "linux" }, () => {
  const run = (name: string) => {
    try {
      execFileSync("sh", ["-c", runningProcessCheck(name)]);
      return true;
    } catch {
      return false;
    }
  };
  assert.equal(run("NoSuchProcessHere"), false);
});

test("an Xvfb left over from an earlier container session counts as running", () => {
  const source = readFileSync(new URL("./named-computer.ts", import.meta.url), "utf8");
  assert.match(source, /if \(listed\.some[\s\S]{0,200}return true;\n  const found = await sandbox\.exec\(runningProcessCheck\(needle\.trim\(\)\)/);
  assert.match(source, /if \(!\(await processRunning\(sandbox, "Xvfb"\)\)\) await startDisplayServer\(sandbox\);/);
});
