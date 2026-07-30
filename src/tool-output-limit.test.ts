import assert from "node:assert/strict";
import test from "node:test";
import { asSchema, type FlexibleSchema } from "ai";
import { z } from "zod";
import { limitModelToolOutput, MODEL_TOOL_OUTPUT_LIMIT_BYTES, limitToolSetOutput, limitToolResultValue, sanitizeModelToolSchema } from "./tool-output-limit";

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

test("wraps native MCP Zod schemas with sanitized JSON Schema and preserved validation", async () => {
  const sourceDefinition = {
    type: "object" as const,
    properties: {
      email: { type: "string" as const, pattern: "^(?!.*\\.\\.)[^@]+@[^@]+$" },
    },
    required: ["email"],
    additionalProperties: false,
  };
  const sourceDefinitionBefore = JSON.parse(JSON.stringify(sourceDefinition));
  const sourceInputSchema = z.fromJSONSchema(sourceDefinition);
  const sourceSchema = asSchema(sourceInputSchema);
  const sourceJsonSchema = await sourceSchema.jsonSchema;
  const set = limitToolSetOutput({
    mcp_email: {
      inputSchema: sourceInputSchema,
      execute: async () => "ok",
    },
  });
  const modelSchema = asSchema((set.mcp_email as { inputSchema: FlexibleSchema }).inputSchema);
  const validate = modelSchema.validate;

  assert.deepEqual(await modelSchema.jsonSchema, {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: { email: { type: "string" } },
    required: ["email"],
    additionalProperties: false,
  });
  assert.ok(validate);
  assert.equal((await validate({ email: "jane@example.com" })).success, true);
  assert.equal((await validate({ email: "jane..doe@example.com" })).success, false);
  assert.deepEqual(await sourceSchema.jsonSchema, sourceJsonSchema);
  assert.deepEqual(sourceDefinition, sourceDefinitionBefore);
});

test("sanitizes JSON Schema regex locations without changing data values", () => {
  const schema = {
    type: "object",
    properties: {
      email: { type: "string", pattern: "^(?!.*\\.\\.)[^@]+@[^@]+$" },
      slug: { type: "string", pattern: "^[a-z0-9-]+$" },
    },
    patternProperties: {
      "^(?!reserved_)[a-z]+$": { type: "string" },
      "^[a-z]+$": {
        type: "string",
        pattern: "(?<=prefix)name$",
        examples: ["(?=example)"],
        default: "(?!default)",
      },
    },
    examples: [
      {
        pattern: "(?=example)",
        patternProperties: { "(?=example)": { pattern: "(?!example)" } },
      },
    ],
    default: { pattern: "(?=default)", patternProperties: { "(?=default)": true } },
    const: { pattern: "(?=const)" },
    enum: [{ pattern: "(?=enum)" }],
    "x-tool-metadata": { pattern: "(?=extension)", patternProperties: { "(?=extension)": { pattern: "(?!extension)" } } },
  };
  const source = JSON.parse(JSON.stringify(schema));

  assert.deepEqual(sanitizeModelToolSchema(schema), {
    type: "object",
    properties: {
      email: { type: "string" },
      slug: { type: "string", pattern: "^[a-z0-9-]+$" },
    },
    patternProperties: {
      "^[a-z]+$": {
        type: "string",
        examples: ["(?=example)"],
        default: "(?!default)",
      },
    },
    examples: [
      {
        pattern: "(?=example)",
        patternProperties: { "(?=example)": { pattern: "(?!example)" } },
      },
    ],
    default: { pattern: "(?=default)", patternProperties: { "(?=default)": true } },
    const: { pattern: "(?=const)" },
    enum: [{ pattern: "(?=enum)" }],
    "x-tool-metadata": { pattern: "(?=extension)", patternProperties: { "(?=extension)": { pattern: "(?!extension)" } } },
  });
  assert.deepEqual(schema, source);
});
