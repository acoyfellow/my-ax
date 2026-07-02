import assert from "node:assert/strict";
import test from "node:test";
import { parseMachineShellContent } from "./machinectl-output";

test("machine shell content is structured for remote Code Mode", () => {
  assert.deepEqual(parseMachineShellContent("Exit code: 0\nprintf output"), {
    stdout: "printf output",
    exitCode: 0,
    raw: "Exit code: 0\nprintf output",
  });
});

test("machine shell parser preserves unknown content without claiming an exit code", () => {
  assert.deepEqual(parseMachineShellContent("plain output"), {
    stdout: "plain output",
    exitCode: null,
    raw: "plain output",
  });
});
