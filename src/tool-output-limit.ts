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
