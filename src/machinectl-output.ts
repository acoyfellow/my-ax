export function parseMachineShellContent(content: string): { stdout: string; exitCode: number | null; raw: string } {
  // Require the exit-code number to be followed by a real line boundary (CRLF/LF)
  // or end-of-input: "Exit code: 0oops" is ordinary content, not a header, and
  // a leading \r must be consumed so CRLF output doesn't leak "\r\n" into stdout.
  const match = content.match(/^Exit code:[ \t]*(-?\d+)[ \t]*(?:\r?\n|$)/);
  if (!match) return { stdout: content, exitCode: null, raw: content };
  // Reject an exit code outside the safe-integer range: Number() would round it
  // (or return Infinity), so we'd report a code that was never sent. Treat the
  // whole thing as ordinary content instead.
  const exitCode = Number(match[1]);
  if (!Number.isSafeInteger(exitCode)) return { stdout: content, exitCode: null, raw: content };
  return { stdout: content.slice(match[0].length), exitCode, raw: content };
}

export const LAPTOP_BUSY_RETRY_AFTER_MS = 2_000;

export type LaptopBusyResult = { ok: false; busy: true; retryAfterMs: number; error: string };

export function laptopBusyResult(retryAfterMs = LAPTOP_BUSY_RETRY_AFTER_MS): LaptopBusyResult {
  return { ok: false, busy: true, retryAfterMs, error: "Laptop busy: too many in-flight calls." };
}

export function machineBusyOutcome(result: { busy?: unknown; retryAfterMs?: unknown }): { busy: true; retryAfterMs: number } | null {
  if (result.busy !== true) return null;
  const retryAfterMs = typeof result.retryAfterMs === "number" && Number.isFinite(result.retryAfterMs) && result.retryAfterMs >= 0
    ? result.retryAfterMs
    : LAPTOP_BUSY_RETRY_AFTER_MS;
  return { busy: true, retryAfterMs };
}
