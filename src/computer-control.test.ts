import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { boundedExecTimeout, COMPUTER_EXEC_MAX_MS, parseComputerInput, tailOutput, xdotoolCommand } from "./computer-control";

test("clicks, moves and scrolls become bounded xdotool pointer commands", () => {
  assert.equal(xdotoolCommand(parseComputerInput({ action: "click", x: 10.4, y: 20 })), "xdotool mousemove 10 20 click 1");
  assert.equal(xdotoolCommand(parseComputerInput({ action: "click", x: 1, y: 2, button: "right", double: true })), "xdotool mousemove 1 2 click --repeat 2 3");
  assert.equal(xdotoolCommand(parseComputerInput({ action: "scroll", x: 5, y: 6, dy: -3 })), "xdotool mousemove 5 6 click --repeat 3 4");
  assert.equal(xdotoolCommand(parseComputerInput({ action: "scroll", x: 5, y: 6, dy: 999 })), "xdotool mousemove 5 6 click --repeat 50 5");
});

test("typed text is single-quoted so the shell never interprets it", () => {
  assert.equal(xdotoolCommand(parseComputerInput({ action: "type", text: "it's $(rm -rf /)" })), "xdotool type --delay 12 -- 'it'\\''s $(rm -rf /)'");
});

test("key names are an allowlisted pattern, not free shell text", () => {
  assert.equal(xdotoolCommand(parseComputerInput({ action: "key", keys: "ctrl+l Return" })), "xdotool key ctrl+l Return");
  assert.throws(() => parseComputerInput({ action: "key", keys: "Return; reboot" }));
  assert.throws(() => parseComputerInput({ action: "key", keys: "$(id)" }));
});

test("bad input is refused", () => {
  assert.throws(() => parseComputerInput({ action: "click", x: -1, y: 0 }));
  assert.throws(() => parseComputerInput({ action: "click", x: "1", y: 0 }));
  assert.throws(() => parseComputerInput({ action: "type", text: "" }));
  assert.throws(() => parseComputerInput({ action: "scroll", x: 1, y: 1, dy: 0 }));
  assert.throws(() => parseComputerInput({ action: "drag" }));
});

test("exec timeouts and output are bounded", () => {
  assert.equal(boundedExecTimeout(undefined), 60_000);
  assert.equal(boundedExecTimeout(10), 1_000);
  assert.equal(boundedExecTimeout(10_000_000), COMPUTER_EXEC_MAX_MS);
  assert.equal(tailOutput("x".repeat(20_000)).length, 12_001);
  assert.equal(tailOutput(undefined), "");
});

test("the computer image ships xdotool and the tools are registered", () => {
  const dockerfile = readFileSync(new URL("../Dockerfile.computer", import.meta.url), "utf8");
  const tools = readFileSync(new URL("./tools.ts", import.meta.url), "utf8");
  assert.match(dockerfile, /xdotool/);
  assert.match(dockerfile, /xdotool git build-essential python3/);
  assert.ok(tools.includes("COMPUTER_EXEC_TOOL") && tools.includes("COMPUTER_INPUT_TOOL"));
});
