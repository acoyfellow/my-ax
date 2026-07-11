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

test("machine shell parser handles CRLF and rejects a false (no-boundary) header", () => {
  assert.deepEqual(parseMachineShellContent("Exit code: 7\r\nfailed"), {
    stdout: "failed",
    exitCode: 7,
    raw: "Exit code: 7\r\nfailed",
  });
  assert.deepEqual(parseMachineShellContent("Exit code: 0oops"), {
    stdout: "Exit code: 0oops",
    exitCode: null,
    raw: "Exit code: 0oops",
  });
});

test("machine shell parser rejects an exit code outside the safe-integer range", () => {
  const content = "Exit code: 9007199254740993\noutput";
  assert.deepEqual(parseMachineShellContent(content), { stdout: content, exitCode: null, raw: content });
});
