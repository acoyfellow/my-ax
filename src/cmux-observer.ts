import type { ToolDef, ToolContext } from "./types";

const DEFAULT_ROOTS = ["cmux"] as const;
const DEFAULT_TAIL_BYTES = 4 * 1024;
const MAX_TAIL_BYTES = 64 * 1024;
const DEFAULT_MAX_SURFACES = 4;
const MAX_SURFACES = 16;
const SURFACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

type CmuxStatusRequest = { kind: "status"; root: string };
type CmuxTailRequest = { kind: "tail"; root: string; workspaceId: string; surfaceId: string; maxBytes: number };

export type CmuxReadRequest = CmuxStatusRequest | CmuxTailRequest;
export type CmuxReader = (request: CmuxReadRequest) => Promise<unknown>;

export type CmuxObserveInput = {
  root?: string;
  surfaceIds?: string[];
  tailBytes?: number;
};

export type CmuxSurface = {
  workspaceId: string;
  surfaceId: string;
  label?: string;
};

export type CmuxObservation = {
  surfaces?: CmuxSurface[];
  tail?: string;
  hashes: {
    status: string;
    tails: Record<string, string>;
  };
  observedAt: string;
  truncated: boolean;
  redacted: boolean;
};

export type CmuxObserveOptions = {
  reader: CmuxReader;
  allowedRoots?: readonly string[];
  allowedSurfaceIds?: readonly string[];
  defaultTailBytes?: number;
  maxTailBytes?: number;
  maxSurfaces?: number;
  now?: () => Date;
};

type CmuxObserveToolOptions = Omit<CmuxObserveOptions, "reader"> & {
  readerForContext: (context: ToolContext) => CmuxReader;
};

type RedactionResult = { value: string; redacted: boolean };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function identifier(value: unknown): string | null {
  return typeof value === "string" && SURFACE_ID_PATTERN.test(value) ? value : null;
}

function normalizePositiveInteger(value: unknown, fallback: number, maximum: number): { value: number; truncated: boolean } {
  if (value === undefined) return { value: fallback, truncated: false };
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error("Expected a positive integer");
  return { value: Math.min(value, maximum), truncated: value > maximum };
}

function boundedLimit(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("CMux observation limits must be positive integers");
  return Math.min(value, maximum);
}

function observationLimits(options: Pick<CmuxObserveOptions, "defaultTailBytes" | "maxTailBytes" | "maxSurfaces">) {
  const maxTailBytes = boundedLimit(options.maxTailBytes, MAX_TAIL_BYTES, MAX_TAIL_BYTES);
  const defaultTailBytes = boundedLimit(options.defaultTailBytes, DEFAULT_TAIL_BYTES, maxTailBytes);
  const maxSurfaces = boundedLimit(options.maxSurfaces, DEFAULT_MAX_SURFACES, MAX_SURFACES);
  return { defaultTailBytes, maxTailBytes, maxSurfaces };
}

function allowedRoots(options: Pick<CmuxObserveOptions, "allowedRoots">): readonly string[] {
  const roots = options.allowedRoots ?? DEFAULT_ROOTS;
  if (!roots.length || roots.some((root) => !identifier(root))) throw new Error("CMux observation roots must be safe identifiers");
  return roots;
}

function configuredSurfaceIds(options: Pick<CmuxObserveOptions, "allowedSurfaceIds">, surfaces: CmuxSurface[]): Set<string> {
  const surfaceIds = options.allowedSurfaceIds ?? surfaces.map((surface) => surface.surfaceId);
  if (surfaceIds.some((surfaceId) => !identifier(surfaceId))) throw new Error("CMux observation surfaces must be safe identifiers");
  return new Set(surfaceIds);
}

function redactText(value: string): RedactionResult {
  let redacted = false;
  const replace = (pattern: RegExp, replacement: string | ((match: string, prefix: string) => string)) => {
    value = value.replace(pattern, (...args: string[]) => {
      redacted = true;
      return typeof replacement === "function" ? replacement(args[0], args[1]) : replacement;
    });
  };
  replace(/\bBearer\s+[^\s"',;]+/gi, "Bearer [REDACTED]");
  replace(/(["']?(?:access[_-]?token|api[_-]?key|token|password|secret|authorization)["']?\s*[:=]\s*)"(?:\\.|[^"])*"/gi, (_match, prefix) => `${prefix}"[REDACTED]"`);
  replace(/(["']?(?:access[_-]?token|api[_-]?key|token|password|secret|authorization)["']?\s*[:=]\s*)'(?:\\.|[^'])*'/gi, (_match, prefix) => `${prefix}'[REDACTED]'`);
  replace(/(["']?(?:access[_-]?token|api[_-]?key|token|password|secret|authorization)["']?\s*[:=]\s*)([^"'\s,}\]]+)/gi, (_match, prefix) => `${prefix}[REDACTED]`);
  replace(/\b(?:sk|rk|pk|ghp|github_pat|xoxb|xoxp|AKIA)[_-][A-Za-z0-9._-]{8,}\b/g, "[REDACTED]");
  return { value, redacted };
}

function asRawText(value: unknown): string {
  if (typeof value === "string") return value;
  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string") throw new Error("CMux reader returned an empty blob");
  return serialized;
}

function statusValue(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error("CMux status reader returned invalid JSON");
  }
}

function extractSurfaces(status: unknown): CmuxSurface[] {
  const entries: CmuxSurface[] = [];
  const seen = new Set<string>();
  const add = (workspaceValue: unknown, surfaceValue: unknown) => {
    const workspace = identifier(workspaceValue);
    const surface = record(surfaceValue);
    const surfaceId = identifier(surface?.id ?? surface?.surfaceId);
    if (!workspace || !surfaceId) return;
    const key = `${workspace}:${surfaceId}`;
    if (seen.has(key)) return;
    seen.add(key);
    const labelValue = surface?.label ?? surface?.title ?? surface?.name;
    entries.push({ workspaceId: workspace, surfaceId, ...(typeof labelValue === "string" ? { label: labelValue } : {}) });
  };
  const root = record(status);
  const workspaces = Array.isArray(root?.workspaces) ? root.workspaces : Array.isArray(status) ? status : [];
  for (const workspaceValue of workspaces) {
    const workspace = record(workspaceValue);
    const workspaceId = workspace?.id ?? workspace?.workspaceId;
    const surfaces = Array.isArray(workspace?.surfaces) ? workspace.surfaces : [];
    for (const surface of surfaces) add(workspaceId, surface);
  }
  const surfaces = Array.isArray(root?.surfaces) ? root.surfaces : [];
  for (const surfaceValue of surfaces) {
    const surface = record(surfaceValue);
    add(surface?.workspaceId, surface);
  }
  return entries;
}

function truncateUtf8(value: string, maxBytes: number): { value: string; truncated: boolean } {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= maxBytes) return { value, truncated: false };
  return { value: new TextDecoder().decode(bytes.slice(0, maxBytes)), truncated: true };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseInput(input: unknown, options: CmuxObserveOptions): { root: string; surfaceIds: string[]; tailBytes: number; maxSurfaces: number; truncated: boolean } {
  const value = record(input);
  if (!value) throw new Error("CMux observation input must be an object");
  const allowedInputKeys = new Set(["root", "surfaceIds", "tailBytes"]);
  for (const key of Object.keys(value)) {
    if (!allowedInputKeys.has(key)) throw new Error(`CMux observation rejects unsupported field: ${key}`);
  }
  const roots = allowedRoots(options);
  const root = value.root === undefined ? roots[0] : identifier(value.root);
  if (!root || !roots.includes(root)) throw new Error("CMux observation root is not allow-listed");
  const limits = observationLimits(options);
  const tail = normalizePositiveInteger(value.tailBytes, limits.defaultTailBytes, limits.maxTailBytes);
  if (value.surfaceIds !== undefined && (!Array.isArray(value.surfaceIds) || value.surfaceIds.some((surfaceId) => !identifier(surfaceId)))) {
    throw new Error("surfaceIds must be an array of allow-listed surface identifiers");
  }
  const surfaceIds = value.surfaceIds ?? [];
  if (new Set(surfaceIds).size !== surfaceIds.length) throw new Error("surfaceIds must not contain duplicates");
  return { root, surfaceIds: surfaceIds.slice(0, limits.maxSurfaces), tailBytes: tail.value, maxSurfaces: limits.maxSurfaces, truncated: tail.truncated || surfaceIds.length > limits.maxSurfaces };
}

export async function observeCmux(input: unknown, options: CmuxObserveOptions): Promise<CmuxObservation> {
  const parsed = parseInput(input, options);
  const rawStatus = asRawText(await options.reader({ kind: "status", root: parsed.root }));
  const statusRedaction = redactText(rawStatus);
  const surfaces = extractSurfaces(statusValue(statusRedaction.value));
  const surfaceIds = configuredSurfaceIds(options, surfaces);
  const allowListedSurfaces = surfaces.filter((surface) => surfaceIds.has(surface.surfaceId));
  const selected = parsed.surfaceIds.length === 0
    ? []
    : parsed.surfaceIds.map((surfaceId) => {
      const matches = allowListedSurfaces.filter((surface) => surface.surfaceId === surfaceId);
      if (matches.length !== 1) throw new Error("CMux surface is not allow-listed");
      return matches[0];
    });
  const tails = await Promise.all(selected.map(async (surface) => {
    const rawTail = asRawText(await options.reader({ kind: "tail", root: parsed.root, workspaceId: surface.workspaceId, surfaceId: surface.surfaceId, maxBytes: parsed.tailBytes }));
    const redaction = redactText(rawTail);
    const tail = truncateUtf8(redaction.value, parsed.tailBytes);
    return { surface, rawTail, tail, redaction };
  }));
  const hashes = {
    status: await sha256(rawStatus),
    tails: Object.fromEntries(await Promise.all(tails.map(async ({ surface, rawTail }) => [surface.surfaceId, await sha256(rawTail)]))),
  };
  const tail = tails.length ? tails.map(({ surface, tail: result }) => `${surface.workspaceId}/${surface.surfaceId}\n${result.value}`).join("\n") : undefined;
  const reportedSurfaces = (selected.length ? selected : allowListedSurfaces).slice(0, parsed.maxSurfaces);
  return {
    ...(reportedSurfaces.length ? { surfaces: reportedSurfaces } : {}),
    ...(tail === undefined ? {} : { tail }),
    hashes,
    observedAt: (options.now ?? (() => new Date()))().toISOString(),
    truncated: parsed.truncated || allowListedSurfaces.length > parsed.maxSurfaces || tails.some(({ tail: result }) => result.truncated),
    redacted: statusRedaction.redacted || tails.some(({ redaction }) => redaction.redacted),
  };
}

export function createCmuxObserveTool(options: CmuxObserveToolOptions): ToolDef {
  const limits = observationLimits(options);
  const roots = allowedRoots(options);
  return {
    name: "cmux_observe",
    description: "Observe allow-listed CMux status and bounded terminal tails through read-only machine APIs. This tool cannot send input, focus, select, open, close, resize, or otherwise change CMux topology.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        root: { type: "string", enum: [...roots] },
        surfaceIds: { type: "array", items: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" }, maxItems: limits.maxSurfaces },
        tailBytes: { type: "integer", minimum: 1, maximum: limits.maxTailBytes, description: "Maximum returned tail bytes per selected surface." },
      },
    },
    execute: async (input, context) => JSON.stringify(await observeCmux(input, { ...options, reader: options.readerForContext(context) })),
  };
}
