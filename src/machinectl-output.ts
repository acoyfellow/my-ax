export function parseMachineShellContent(content: string): { stdout: string; exitCode: number | null; raw: string } {
  const match = content.match(/^Exit code:\s*(-?\d+)\n?/);
  if (!match) return { stdout: content, exitCode: null, raw: content };
  return { stdout: content.slice(match[0].length), exitCode: Number(match[1]), raw: content };
}
