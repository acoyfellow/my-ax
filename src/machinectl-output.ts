export function parseMachineShellContent(content: string): { stdout: string; exitCode: number | null; raw: string } {
  // Require the exit-code number to be followed by a real line boundary (CRLF/LF)
  // or end-of-input: "Exit code: 0oops" is ordinary content, not a header, and
  // a leading \r must be consumed so CRLF output doesn't leak "\r\n" into stdout.
  const match = content.match(/^Exit code:[ \t]*(-?\d+)(?:\r?\n|$)/);
  if (!match) return { stdout: content, exitCode: null, raw: content };
  return { stdout: content.slice(match[0].length), exitCode: Number(match[1]), raw: content };
}
