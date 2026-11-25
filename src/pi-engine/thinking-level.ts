export type ThinkingLevel = "low" | "medium" | "high";

export function sanitizeThinkingLevel(value: unknown): ThinkingLevel | undefined {
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
}
