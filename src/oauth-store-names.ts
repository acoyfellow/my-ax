export const MCP_DISPLAY_NAME_MAX = 60;

export function normalizeMcpDisplayName(raw: string): string | null {
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return name.length > 0 && name.length <= MCP_DISPLAY_NAME_MAX ? name : null;
}
