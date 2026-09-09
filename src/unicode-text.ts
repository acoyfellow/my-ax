export const MAX_GENERATED_SESSION_TITLE_CODE_POINTS = 60;

export function truncateUnicodeCodePoints(value: string, maximum: number): string {
  return Array.from(value).slice(0, maximum).join("");
}
