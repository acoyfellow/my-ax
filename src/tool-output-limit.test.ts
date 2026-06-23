import assert from "node:assert/strict";
import test from "node:test";
import { limitModelToolOutput, MODEL_TOOL_OUTPUT_LIMIT_BYTES } from "./tool-output-limit";

const bytes = (value: string) => new TextEncoder().encode(value).byteLength;

test("leaves sub-cap tool output unchanged", () => {
  const output = "small structured result";
  assert.equal(limitModelToolOutput(output), output);
});

test("truncates oversized tool output with accurate byte counts", () => {
  const output = "x".repeat(MODEL_TOOL_OUTPUT_LIMIT_BYTES + 1234);
  const limited = limitModelToolOutput(output);
  assert.equal(
    limited,
    `${"x".repeat(MODEL_TOOL_OUTPUT_LIMIT_BYTES)}\n\n[truncated: original ${bytes(output)} bytes, retained ${MODEL_TOOL_OUTPUT_LIMIT_BYTES} bytes]`,
  );
});

test("backs up to a complete code point at a multibyte boundary", () => {
  const output = `${"x".repeat(MODEL_TOOL_OUTPUT_LIMIT_BYTES - 1)}💡tail`;
  const limited = limitModelToolOutput(output);
  const marker = `\n\n[truncated: original ${bytes(output)} bytes, retained ${MODEL_TOOL_OUTPUT_LIMIT_BYTES - 1} bytes]`;
  assert.equal(limited, `${"x".repeat(MODEL_TOOL_OUTPUT_LIMIT_BYTES - 1)}${marker}`);
  assert.doesNotMatch(limited, /�/u);
});
