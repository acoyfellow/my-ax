export type ToolArguments = Record<string, unknown>;

function parseJsonArguments(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    throw new TypeError("Tool arguments must be a JSON object");
  }
}

export function coerceToolArguments(input: unknown): ToolArguments {
  const value = typeof input === "string" ? parseJsonArguments(input) : input;
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Tool arguments must be an object");
  }
  return value as ToolArguments;
}
