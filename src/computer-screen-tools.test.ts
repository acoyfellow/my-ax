import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { screenRecordPath, screenWaitPath } from "./computer-screen-tools";

test("wait passes voxl's idle, change, region and since through with bounded timeouts", () => {
  assert.equal(screenWaitPath({}), "/wait?timeout=10000");
  assert.equal(screenWaitPath({ idle: 1000, timeout: 30000 }), "/wait?idle=1000&timeout=30000");
  assert.equal(screenWaitPath({ change: true, region: "0,0,800,600", since: 812 }), "/wait?change&region=0%2C0%2C800%2C600&since=812&timeout=10000");
  assert.equal(screenWaitPath({ timeout: 999_999, idle: -5 }), "/wait?idle=0&timeout=60000");
  assert.equal(screenWaitPath({ region: "0,0,800;rm", since: -1 }), "/wait?timeout=10000");
});

test("record asks for 1 to 30 seconds", () => {
  assert.equal(screenRecordPath(undefined), "/record?seconds=5");
  assert.equal(screenRecordPath(10), "/record?seconds=10");
  assert.equal(screenRecordPath(0), "/record?seconds=1");
  assert.equal(screenRecordPath(600), "/record?seconds=30");
  assert.equal(screenRecordPath("10"), "/record?seconds=5");
});

test("the three screen tools are registered agent tools", () => {
  const tools = readFileSync(new URL("./tools.ts", import.meta.url), "utf8");
  for (const name of ["COMPUTER_SCREENSHOT_TOOL", "COMPUTER_WAIT_TOOL", "COMPUTER_RECORD_TOOL"]) {
    assert.match(tools, new RegExp(`^  ${name},$`, "m"), name);
  }
});

test("voxl leaves sign-in to Access through the Worker", () => {
  const named = readFileSync(new URL("./named-computer.ts", import.meta.url), "utf8");
  assert.match(named, /voxl --addr=0\.0\.0\.0 --port=\$\{COMPUTER_SCREEN_PORT\} --enable-basic-auth=false/);
});
