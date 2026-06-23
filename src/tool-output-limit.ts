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

/** Wrap every executable tool in a tool set so its result is bounded. Used for
 * native MCP / Code Mode tools, which do not pass through createThinkTools. */
export function limitToolSetOutput<T extends Record<string, unknown>>(tools: T): T {
  const out: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(tools)) {
    const execute = (def as { execute?: unknown })?.execute;
    if (def && typeof execute === "function") {
      const original = (execute as (...args: unknown[]) => unknown).bind(def);
      out[name] = { ...(def as object), execute: async (...args: unknown[]) => limitToolResultValue(await original(...args)) };
    } else {
      out[name] = def;
    }
  }
  return out as T;
}
