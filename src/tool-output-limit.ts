import { asSchema, jsonSchema, type FlexibleSchema } from "ai";
import { MODEL_TOOL_OUTPUT_LIMIT_BYTES } from "./model-tool-output-limit";

export { MODEL_TOOL_OUTPUT_LIMIT_BYTES };

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/** Bound model-visible tool output without cutting through a UTF-8 code point. */
export function limitModelToolOutput(
  output: string,
  limitBytes = MODEL_TOOL_OUTPUT_LIMIT_BYTES,
): string {
  const bytes = encoder.encode(output);
  if (bytes.byteLength <= limitBytes) return output;

  let retainedBytes = limitBytes;
  let prefix = "";
  while (retainedBytes > 0) {
    try {
      prefix = decoder.decode(bytes.subarray(0, retainedBytes));
      break;
    } catch {
      retainedBytes -= 1;
    }
  }

  return `${prefix}\n\n[truncated: original ${bytes.byteLength} bytes, retained ${retainedBytes} bytes]`;
}

/** Cap one tool result value (string capped directly; oversized non-strings
 * are serialized and capped) so model-visible output stays bounded. */
export function limitToolResultValue(value: unknown): unknown {
  if (typeof value === "string") return limitModelToolOutput(value);
  if (value == null) return value;
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return value;
  }
  if (typeof serialized !== "string") return value;
  if (new TextEncoder().encode(serialized).byteLength <= MODEL_TOOL_OUTPUT_LIMIT_BYTES) return value;
  return limitModelToolOutput(serialized);
}

const aiSdkSchemaSymbol = Symbol.for("vercel.ai.schema");

function hasUnsupportedRegexLookaround(pattern: string): boolean {
  let insideCharacterClass = false;

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "[") {
      insideCharacterClass = true;
      continue;
    }
    if (character === "]" && insideCharacterClass) {
      insideCharacterClass = false;
      continue;
    }
    if (insideCharacterClass || character !== "(" || pattern[index + 1] !== "?") continue;

    const assertionType = pattern[index + 2];
    if (assertionType === "=" || assertionType === "!") return true;
    if (assertionType === "<" && (pattern[index + 3] === "=" || pattern[index + 3] === "!")) return true;
  }

  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function copyJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(copyJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => [key, copyJsonValue(nestedValue)]));
}

function sanitizeSchemaValue(value: unknown): unknown {
  return isRecord(value) ? sanitizeSchemaObject(value) : copyJsonValue(value);
}

function sanitizeSchemaMap(value: unknown): unknown {
  if (!isRecord(value)) return copyJsonValue(value);
  return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => [key, sanitizeSchemaValue(nestedValue)]));
}

function sanitizePatternProperties(value: unknown): unknown {
  if (!isRecord(value)) return copyJsonValue(value);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([pattern]) => !hasUnsupportedRegexLookaround(pattern))
      .map(([pattern, schema]) => [pattern, sanitizeSchemaValue(schema)]),
  );
}

function sanitizeSchemaArray(value: unknown): unknown {
  return Array.isArray(value) ? value.map(sanitizeSchemaValue) : copyJsonValue(value);
}

function sanitizeDependencies(value: unknown): unknown {
  if (!isRecord(value)) return copyJsonValue(value);
  return Object.fromEntries(Object.entries(value).map(([key, dependency]) => [
    key,
    isRecord(dependency) || typeof dependency === "boolean" ? sanitizeSchemaValue(dependency) : copyJsonValue(dependency),
  ]));
}

function sanitizeSchemaObject(schema: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "pattern" && typeof value === "string" && hasUnsupportedRegexLookaround(value)) continue;
    if (key === "patternProperties") {
      sanitized[key] = sanitizePatternProperties(value);
      continue;
    }
    if (key === "properties" || key === "$defs" || key === "definitions" || key === "dependentSchemas") {
      sanitized[key] = sanitizeSchemaMap(value);
      continue;
    }
    if (key === "allOf" || key === "anyOf" || key === "oneOf" || key === "prefixItems") {
      sanitized[key] = sanitizeSchemaArray(value);
      continue;
    }
    if (key === "additionalProperties" || key === "additionalItems" || key === "contains" || key === "contentSchema" || key === "else" || key === "if" || key === "items" || key === "not" || key === "propertyNames" || key === "then" || key === "unevaluatedItems" || key === "unevaluatedProperties") {
      sanitized[key] = Array.isArray(value) && key === "items" ? sanitizeSchemaArray(value) : sanitizeSchemaValue(value);
      continue;
    }
    if (key === "dependencies") {
      sanitized[key] = sanitizeDependencies(value);
      continue;
    }
    sanitized[key] = copyJsonValue(value);
  }
  return sanitized;
}

function isAiSdkCompatibleSchema(value: unknown): value is FlexibleSchema {
  return typeof value === "function" || (isRecord(value) && (aiSdkSchemaSymbol in value || "~standard" in value));
}

export function sanitizeModelToolSchema(value: unknown): unknown {
  if (!isAiSdkCompatibleSchema(value)) return sanitizeSchemaValue(value);

  const sourceSchema = asSchema(value);
  return jsonSchema(
    async () => sanitizeSchemaValue(await sourceSchema.jsonSchema) as Awaited<typeof sourceSchema.jsonSchema>,
    { validate: sourceSchema.validate },
  );
}

export function limitToolSetOutput<T extends Record<string, unknown>>(tools: T): T {
  const out: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(tools)) {
    if (!def || typeof def !== "object") {
      out[name] = def;
      continue;
    }

    const safeDefinition = { ...(def as Record<string, unknown>) };
    if ("inputSchema" in safeDefinition) safeDefinition.inputSchema = sanitizeModelToolSchema(safeDefinition.inputSchema);
    const execute = safeDefinition.execute;
    if (typeof execute === "function") {
      const original = (execute as (...args: unknown[]) => unknown).bind(def);
      safeDefinition.execute = async (...args: unknown[]) => limitToolResultValue(await original(...args));
    }
    out[name] = safeDefinition;
  }
  return out as T;
}
