import assert from "node:assert/strict";
import test from "node:test";
import { limitModelToolOutput, MODEL_TOOL_OUTPUT_LIMIT_BYTES, limitToolSetOutput, limitToolResultValue } from "./tool-output-limit";

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

test("limitToolSetOutput bounds native MCP tool output", async () => {
  const big = "y".repeat(40 * 1024);
  const set = limitToolSetOutput({
    mcp_x: { description: "d", execute: async () => big },
    mcp_obj: { description: "d", execute: async () => ({ blob: big }) },
    no_exec: { description: "no execute" },
  });
  const s = await (set.mcp_x as any).execute();
  assert.ok(new TextEncoder().encode(s).byteLength < 40 * 1024);
  assert.match(s, /\[truncated: original \d+ bytes, retained \d+ bytes\]/);
  const o = await (set.mcp_obj as any).execute();
  assert.equal(typeof o, "string");
  assert.match(o, /\[truncated:/);
  assert.equal((set.no_exec as any).description, "no execute");
});

test("limitToolResultValue leaves small values unchanged", () => {
  assert.equal(limitToolResultValue("ok"), "ok");
  const small = { a: 1 };
  assert.equal(limitToolResultValue(small), small);
});
