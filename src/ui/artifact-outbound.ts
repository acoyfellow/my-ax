export const OUTBOUND_INVOKE_TIMEOUT_MS = 8000;
export const MAX_OUTBOUND_CALLS_PER_MINUTE = 60;
const MAX_OUTBOUND_STRING_ARG = 4000;

export const OUTBOUND_ALLOWLIST = [
  "listSessions",
  "readHealth",
  "readVersion",
  "readTranscriptTail",
  "switchSession",
  "openSettings",
  "openAttention",
  "openSessions",
  "openTerminal",
  "notify",
  "navigate",
  "deskRead",
  "deskWrite",
  "sendToSession",
] as const;

export type OutboundVerb = (typeof OUTBOUND_ALLOWLIST)[number];

const ALLOWED = new Set<string>(OUTBOUND_ALLOWLIST);

export function isOutboundVerbAllowed(name: unknown): name is OutboundVerb {
  return typeof name === "string" && ALLOWED.has(name);
}

export function boundOutboundArgs(args: unknown): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  if (args === undefined || args === null) return { ok: true, args: {} };
  if (typeof args !== "object" || Array.isArray(args)) return { ok: false, error: "args must be an object" };
  const entries = Object.entries(args as Record<string, unknown>);
  if (entries.length > 16) return { ok: false, error: "too many args" };
  const out: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(key)) return { ok: false, error: `bad arg name: ${key}` };
    if (typeof value === "string") {
      if (value.length > MAX_OUTBOUND_STRING_ARG) return { ok: false, error: `${key} too long` };
      out[key] = value;
    } else if (typeof value === "number") {
      if (!Number.isFinite(value)) return { ok: false, error: `${key} must be finite` };
      out[key] = value;
    } else if (typeof value === "boolean" || value === null) {
      out[key] = value;
    } else {
      return { ok: false, error: `${key} must be a string, number, boolean, or null` };
    }
  }
  return { ok: true, args: out };
}

export interface OutboundHost {
  artifactIdForWindow: (source: unknown) => string | null;
  runVerb: (verb: OutboundVerb, args: Record<string, unknown>) => Promise<unknown>;
  postToArtifact: (artifactId: string, frame: unknown) => boolean;
  now?: () => number;
}

type CallWindow = { start: number; count: number };

export class ArtifactOutboundBridge {
  private windows = new Map<string, CallWindow>();
  private frozen = false;
  constructor(private host: OutboundHost) {}

  private get now() { return this.host.now ?? (() => Date.now()); }

  setNavFrozen(frozen: boolean): void { this.frozen = frozen; }

  private overBudget(artifactId: string): boolean {
    const now = this.now();
    const existing = this.windows.get(artifactId);
    if (!existing || now - existing.start >= 60_000) {
      this.windows.set(artifactId, { start: now, count: 1 });
      return false;
    }
    existing.count += 1;
    return existing.count > MAX_OUTBOUND_CALLS_PER_MINUTE;
  }

  async handleCall(source: unknown, frame: unknown): Promise<boolean> {
    const message = frame as { type?: unknown; callId?: unknown; verb?: unknown; args?: unknown };
    if (!message || message.type !== "my-ax:host-invoke") return false;
    const callId = typeof message.callId === "string" ? message.callId : "";
    if (!callId) return false;
    const artifactId = this.host.artifactIdForWindow(source);
    if (!artifactId) return false;
    const reply = (ok: boolean, result?: unknown, error?: string) => {
      this.host.postToArtifact(artifactId, { type: "my-ax:host-invoke-result", callId, ok, ...(ok ? { result } : { error }) });
    };
    if (this.frozen) { reply(false, undefined, "host_unavailable"); return true; }
    if (!isOutboundVerbAllowed(message.verb)) { reply(false, undefined, "host_verb_not_allowed"); return true; }
    if (this.overBudget(artifactId)) { reply(false, undefined, "host_rate_limited"); return true; }
    const bounded = boundOutboundArgs(message.args);
    if (!bounded.ok) { reply(false, undefined, `host_bad_args: ${bounded.error}`); return true; }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reply(false, undefined, "host_invoke_timeout");
    }, OUTBOUND_INVOKE_TIMEOUT_MS);
    try {
      const result = await this.host.runVerb(message.verb, bounded.args);
      if (!settled) { settled = true; reply(true, result ?? null); }
    } catch (error) {
      if (!settled) { settled = true; reply(false, undefined, error instanceof Error ? error.message : String(error)); }
    } finally {
      clearTimeout(timer);
    }
    return true;
  }
}
