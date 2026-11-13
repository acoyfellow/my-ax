export const PIN_SIZES = ["small", "medium", "large"] as const;
export type PinSize = (typeof PIN_SIZES)[number];

export function parsePinSize(value: unknown): PinSize | null {
  return typeof value === "string" && (PIN_SIZES as readonly string[]).includes(value) ? (value as PinSize) : null;
}

export function pinSizeOf(value: unknown): PinSize {
  return parsePinSize(value) ?? "small";
}

export function nextPinSize(size: PinSize): PinSize {
  return PIN_SIZES[(PIN_SIZES.indexOf(size) + 1) % PIN_SIZES.length];
}

export const PIN_SIZE_LABEL: Record<PinSize, string> = { small: "Small", medium: "Wide", large: "Large" };
