export const MODEL_TOOL_OUTPUT_LIMIT_BYTES = 24 * 1024;

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

const unsupportedRegexConstruct = /\(\?(?:[=!]|<[=!])/u;

export function sanitizeModelToolSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeModelToolSchema);
  if (!value || typeof value !== "object") return value;

  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (key === "pattern" && typeof nestedValue === "string" && unsupportedRegexConstruct.test(nestedValue)) continue;
    sanitized[key] = sanitizeModelToolSchema(nestedValue);
  }
  return sanitized;
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
