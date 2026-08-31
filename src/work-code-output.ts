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

export function summarizeCmuxInventory(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const workspaces = record.workspaces;
  if (!Array.isArray(workspaces) || workspaces.length === 0) return value;
  const rows = workspaces.filter((row) => row && typeof row === "object" && !Array.isArray(row)) as Array<Record<string, unknown>>;
  if (!rows.length || !("id" in rows[0] || "title" in rows[0])) return value;
  const compact = rows.map((row) => {
    const sessions = Array.isArray(row.piSessions) ? row.piSessions : [];
    const dispatchable = sessions.filter((session) => session && typeof session === "object" && (session as { dispatchable?: unknown }).dispatchable === true).length;
    return {
      id: row.id ?? null,
      title: row.title ?? null,
      surfaces: Array.isArray(row.surfaces) ? row.surfaces.length : 0,
      piSessions: sessions.length,
      dispatchable,
    };
  });
  return {
    workspaceCount: compact.length,
    dispatchableCount: compact.reduce((sum, row) => sum + row.dispatchable, 0),
    titles: compact.map((row) => row.title).filter((title) => typeof title === "string").slice(0, 16),
    workspaces: compact,
    truncated: true,
    reason: "cmux_inventory_summary",
  };
}

export function capWorkCodeValue(value: unknown, maxBytes: number): unknown {
  const summarized = summarizeCmuxInventory(value);
  try {
    const summarizedJson = JSON.stringify(summarized);
    if (summarized !== value && byteLength(summarizedJson) <= maxBytes) return summarized;
  } catch {
    void 0;
  }
  const budget: Budget = { remaining: Math.max(0, Math.floor(maxBytes / 4)), seen: new Set() };
  const bounded = boundedValue(summarized, budget);
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

export type WorkCodeCallRecord<Where extends string = string> = {
  index: number;
  where: Where;
  method: string;
  status: "ok" | "error";
  durationMs: number;
  error?: string;
};

export type WorkCodeCallMetadata = {
  sandboxMutation: boolean;
  codemodeInvoked: boolean;
};

type WorkCodeFunction = (input: unknown) => Promise<unknown>;
type WorkCodeFunctions = Record<string, WorkCodeFunction>;

export class WorkCodeCallCollector<Where extends string = string> {
  #calls: WorkCodeCallRecord<Where>[] = [];
  #attemptedCalls = 0;
  #callsTruncated = false;
  #sandboxMutation = false;
  #codemodeInvoked = false;
  #inferredCapabilities = new Set<string>();
  #inferredCapabilitiesTruncated = false;

  recordAttempt(where: Where, method: string, metadata: WorkCodeCallMetadata): WorkCodeCallRecord<Where> | undefined {
    this.#attemptedCalls = Math.min(WORK_CODE_CALLS_MAX_ENTRIES + 1, this.#attemptedCalls + 1);
    this.#sandboxMutation ||= metadata.sandboxMutation;
    this.#codemodeInvoked ||= metadata.codemodeInvoked;
    const capability = `${where}.${method}`;
    if (!this.#inferredCapabilities.has(capability)) {
      if (this.#inferredCapabilities.size < WORK_CODE_CALLS_MAX_ENTRIES) {
        this.#inferredCapabilities.add(capability);
      } else {
        this.#inferredCapabilitiesTruncated = true;
      }
    }
    if (this.#calls.length >= WORK_CODE_CALLS_MAX_ENTRIES) {
      this.#callsTruncated = true;
      return undefined;
    }
    const call: WorkCodeCallRecord<Where> = { index: this.#attemptedCalls - 1, where, method, status: "ok", durationMs: 0 };
    this.#calls.push(call);
    return call;
  }

  recordSuccess(call: WorkCodeCallRecord<Where> | undefined, durationMs: number) {
    if (!call) return;
    call.status = "ok";
    call.durationMs = durationMs;
    delete call.error;
  }

  recordFailure(call: WorkCodeCallRecord<Where> | undefined, durationMs: number, error: unknown) {
    if (!call) return;
    call.status = "error";
    call.durationMs = durationMs;
    call.error = (error instanceof Error ? error.message : String(error)).slice(0, 300);
  }

  get calls(): readonly WorkCodeCallRecord<Where>[] {
    return this.#calls;
  }

  get attemptedCalls(): number {
    return this.#attemptedCalls;
  }

  get callsTruncated(): boolean {
    return this.#callsTruncated;
  }

  get sandboxMutation(): boolean {
    return this.#sandboxMutation;
  }

  get codemodeInvoked(): boolean {
    return this.#codemodeInvoked;
  }

  get inferredCapabilities(): string[] {
    return [...this.#inferredCapabilities].sort();
  }

  get inferredCapabilitiesTruncated(): boolean {
    return this.#inferredCapabilitiesTruncated;
  }
}

export function instrumentWorkCodeFunctions<Where extends string, T extends WorkCodeFunctions>(
  where: Where,
  functions: T,
  collector: WorkCodeCallCollector<Where>,
  metadataForMethod: (method: string) => WorkCodeCallMetadata,
): T {
  return Object.fromEntries(Object.entries(functions).map(([method, invoke]) => [method, async (input: unknown) => {
    const call = collector.recordAttempt(where, method, metadataForMethod(method));
    const started = Date.now();
    try {
      const result = await invoke(input);
      collector.recordSuccess(call, Date.now() - started);
      return result;
    } catch (error) {
      collector.recordFailure(call, Date.now() - started, error);
      throw error;
    }
  }])) as T;
}

export function capWorkCodeCollectionWithMetadata(values: readonly unknown[], maxEntries: number, maxBytes: number): CappedWorkCodeCollection {
  if (!Number.isFinite(maxBytes) || maxBytes < 2) throw new RangeError("maxBytes must fit an empty JSON array");
  const output: unknown[] = [];
  const entryLimit = Math.max(0, Math.floor(maxEntries));
  const byteLimit = Math.floor(maxBytes);
  let used = 2;
  let truncated = false;
  for (const value of values) {
    if (output.length >= entryLimit) {
      truncated = true;
      break;
    }
    const separatorBytes = output.length ? 1 : 0;
    const remaining = byteLimit - used - separatorBytes;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    let capped = capWorkCodeValue(value, 1024);
    let serialized = JSON.stringify(capped);
    let bytes = byteLength(serialized);
    if (bytes > remaining) {
      capped = capWorkCodeValue(value, remaining);
      serialized = JSON.stringify(capped);
      bytes = byteLength(serialized);
    }
    if (bytes > remaining) {
      truncated = true;
      break;
    }
    output.push(capped);
    used += separatorBytes + bytes;
  }
  return { values: output, truncated };
}

export function capWorkCodeCollection(values: readonly unknown[], maxEntries: number, maxBytes: number): unknown[] {
  return capWorkCodeCollectionWithMetadata(values, maxEntries, maxBytes).values;
}
