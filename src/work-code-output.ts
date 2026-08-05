export const WORK_CODE_CALLS_MAX_ENTRIES = 128;
export const WORK_CODE_CALLS_MAX_BYTES = 8 * 1024;
export const WORK_CODE_LOGS_MAX_ENTRIES = 64;
export const WORK_CODE_LOGS_MAX_BYTES = 8 * 1024;
export const WORK_CODE_RESULT_MAX_BYTES = 12 * 1024;

const encoder = new TextEncoder();

type Budget = {
  remaining: number;
  seen: Set<object>;
};

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) return value;
  const suffix = "…";
  const available = Math.max(0, maxBytes - byteLength(suffix));
  let output = "";
  for (const character of value) {
    if (byteLength(output + character) > available) break;
    output += character;
  }
  return `${output}${suffix}`;
}

function consumeText(value: string, budget: Budget): string {
  const allowance = Math.max(0, Math.floor(budget.remaining / 8));
  const output = truncateUtf8(value, allowance);
  budget.remaining = Math.max(0, budget.remaining - byteLength(output));
  return output;
}

function boundedValue(value: unknown, budget: Budget, depth = 0): unknown {
  if (budget.remaining <= 0) return "[truncated]";
  if (value === null || typeof value === "boolean") {
    budget.remaining -= 8;
    return value;
  }
  if (typeof value === "number") {
    budget.remaining -= 32;
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === "string") return consumeText(value, budget);
  if (typeof value === "bigint") return consumeText(value.toString(), budget);
  if (typeof value !== "object") return consumeText(String(value), budget);
  if (depth >= 8) return "[truncated: maximum depth]";
  if (budget.seen.has(value)) return "[truncated: circular]";
  budget.seen.add(value);
  try {
    if (Array.isArray(value)) {
      const output: unknown[] = [];
      const limit = Math.min(value.length, 64);
      for (let index = 0; index < limit && budget.remaining > 0; index += 1) {
        output.push(boundedValue(value[index], budget, depth + 1));
      }
      if (value.length > limit) output.push("[truncated: remaining entries]");
      return output;
    }
    const output: Record<string, unknown> = {};
    let entries = 0;
    for (const key in value as Record<string, unknown>) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      if (entries >= 64 || budget.remaining <= 0) {
        output.truncated = true;
        break;
      }
      output[consumeText(key, budget)] = boundedValue((value as Record<string, unknown>)[key], budget, depth + 1);
      entries += 1;
    }
    return output;
  } finally {
    budget.seen.delete(value);
  }
}

export function capWorkCodeValue(value: unknown, maxBytes: number): unknown {
  const budget: Budget = { remaining: Math.max(0, Math.floor(maxBytes / 4)), seen: new Set() };
  const bounded = boundedValue(value, budget);
  let serialized: string;
  try {
    serialized = JSON.stringify(bounded);
  } catch {
    return { truncated: true, reason: "not_serializable" };
  }
  if (byteLength(serialized) <= maxBytes) return bounded;
  return {
    truncated: true,
    preview: truncateUtf8(serialized, Math.max(64, Math.floor(maxBytes / 8))),
  };
}

export type CappedWorkCodeCollection = {
  values: unknown[];
  truncated: boolean;
};

export function capWorkCodeCollectionWithMetadata(values: unknown[], maxEntries: number, maxBytes: number): CappedWorkCodeCollection {
  const output: unknown[] = [];
  let used = 0;
  let truncated = false;
  for (const value of values) {
    if (output.length >= maxEntries) {
      truncated = true;
      break;
    }
    const remaining = maxBytes - used;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const capped = capWorkCodeValue(value, Math.max(128, Math.min(1024, remaining)));
    const serialized = JSON.stringify(capped);
    const bytes = byteLength(serialized);
    if (bytes > remaining) {
      truncated = true;
      break;
    }
    output.push(capped);
    used += bytes;
  }
  return { values: output, truncated };
}

export function capWorkCodeCollection(values: unknown[], maxEntries: number, maxBytes: number): unknown[] {
  return capWorkCodeCollectionWithMetadata(values, maxEntries, maxBytes).values;
}
