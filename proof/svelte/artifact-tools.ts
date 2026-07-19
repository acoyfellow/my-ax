// artifact-tools.ts — parent-side registry + handshake for artifact-proposed
// tools (page connector v2). A sandboxed artifact iframe PROPOSES scoped tools;
// the server agent INVOKES them, parent-mediated, through the page connector.
//
// SECURITY MODEL (Kenton's 5 gaps, see DESIGN.md):
//   G1 id is derived from the SOURCE WINDOW (data-artifact-id), never trusted
//      from the message; a namespace bound to one window can't be claimed by another.
//   G2 pending invokes reject with artifact_gone on unregister; new invokes are
//      refused during a disruptive nav.
//   G3 inner (client->iframe) timeout strictly < outer (DO->client) timeout.
//   G4 global cap on total proposed verbs; they are NOT in the default work_search
//      catalog (surfaced only via listArtifactTools / invokeArtifactTool).
//   G5 parent validates args against the registered schema before relaying.
//
// This module is DOM/postMessage-light and dependency-free so it is unit-testable:
// the host injects a small `PostBridge` (how to find the window for an id + how to
// post to it) instead of touching the real DOM directly.

export interface ArtifactToolSchema {
  // A bounded, declarative JSON-schema-lite. Only these shapes are honored.
  [key: string]: "string" | "number" | "boolean" | "string?" | "number?" | "boolean?";
}

export interface ArtifactToolDef {
  name: string;
  description: string;
  inputSchema?: ArtifactToolSchema;
}

export interface RegisteredArtifact {
  artifactId: string;
  tools: Map<string, ArtifactToolDef>;
}

export const MAX_TOOLS_PER_ARTIFACT = 8;
export const MAX_ARTIFACT_VERBS_TOTAL = 32;
export const INNER_INVOKE_TIMEOUT_MS = 6000; // G3: strictly < outer 10s DO timeout
const TOOL_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,40}$/;
const MAX_STRING_ARG = 4000;

// The host provides these so the registry never touches the DOM/global directly.
export interface ArtifactHostBridge {
  // Return the artifactId bound to a given source window, or null if that window
  // is not a live artifact iframe on this page. This is the G1 trust anchor.
  artifactIdForWindow: (source: unknown) => string | null;
  // Post an invoke frame to the window bound to artifactId. Returns false if the
  // window is gone. The host owns the actual iframe.contentWindow.postMessage.
  postToArtifact: (artifactId: string, frame: unknown) => boolean;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: unknown; artifactId: string };

export class ArtifactToolRegistry {
  private artifacts = new Map<string, RegisteredArtifact>();
  private pending = new Map<string, Pending>();
  private navFrozen = false;
  private callSeq = 0;
  constructor(private host: ArtifactHostBridge) {}

  private get setTimer() { return this.host.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms)); }
  private get clearTimer() { return this.host.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>)); }

  private totalVerbCount(): number {
    let n = 0;
    for (const a of this.artifacts.values()) n += a.tools.size;
    return n;
  }

  /** G2: freeze new invokes during a disruptive nav / session teardown. */
  setNavFrozen(frozen: boolean): void { this.navFrozen = frozen; }

  /**
   * Handle a register message. `source` is the raw event.source; the id is
   * resolved FROM it (G1), never taken from the message. Returns a typed result.
   */
  register(source: unknown, tools: unknown): { ok: boolean; artifactId?: string; registered?: string[]; error?: string } {
    const artifactId = this.host.artifactIdForWindow(source);
    if (!artifactId) return { ok: false, error: "artifact_source_invalid" }; // A1 spoofed source
    if (!Array.isArray(tools)) return { ok: false, error: "artifact_bad_register" };
    const existing = this.artifacts.get(artifactId);
    // G1: an id is bound to exactly one window; the id came FROM the window, so a
    // different window cannot present this id. (Defense in depth: re-register from
    // the same window replaces its own tool set.)
    const clean: ArtifactToolDef[] = [];
    for (const t of tools.slice(0, MAX_TOOLS_PER_ARTIFACT + 1)) {
      const def = t as ArtifactToolDef;
      if (!def || typeof def.name !== "string" || !TOOL_NAME_RE.test(def.name)) return { ok: false, error: "artifact_bad_tool_name" };
      clean.push({ name: def.name, description: String(def.description ?? "").slice(0, 300), inputSchema: sanitizeSchema(def.inputSchema) });
    }
    if (clean.length > MAX_TOOLS_PER_ARTIFACT) return { ok: false, error: "artifact_too_many_tools" };
    // G4: global cap. Count what this artifact would ADD (replacing its own prior set).
    const prior = existing ? existing.tools.size : 0;
    if (this.totalVerbCount() - prior + clean.length > MAX_ARTIFACT_VERBS_TOTAL) return { ok: false, error: "artifact_registry_full" };
    const toolMap = new Map<string, ArtifactToolDef>();
    for (const t of clean) toolMap.set(t.name, t);
    this.artifacts.set(artifactId, { artifactId, tools: toolMap });
    return { ok: true, artifactId, registered: clean.map((t) => t.name) };
  }

  /** G2: drop an artifact and reject its pending invokes with artifact_gone. */
  unregister(artifactId: string): void {
    this.artifacts.delete(artifactId);
    for (const [callId, p] of [...this.pending.entries()]) {
      if (p.artifactId === artifactId) {
        this.clearTimer(p.timer);
        this.pending.delete(callId);
        p.reject(new Error("artifact_gone"));
      }
    }
  }

  /** The agent-discoverable catalog (NOT in default work_search — G4). */
  listTools(): Array<{ artifactId: string; name: string; description: string }> {
    const out: Array<{ artifactId: string; name: string; description: string }> = [];
    for (const a of this.artifacts.values()) for (const t of a.tools.values()) out.push({ artifactId: a.artifactId, name: t.name, description: t.description });
    return out;
  }

  /** Resolve an inbound invoke-result frame from an iframe. */
  resolveResult(callId: string, ok: boolean, result?: unknown, error?: string): void {
    const p = this.pending.get(callId);
    if (!p) return;
    this.clearTimer(p.timer);
    this.pending.delete(callId);
    if (ok) p.resolve(result ?? null);
    else p.reject(new Error(error || "artifact_invoke_failed"));
  }

  /**
   * Invoke a proposed tool. Parent-mediated: validates existence + args (G5),
   * refuses during nav (G2), routes ONLY to the bound window (G1/A2), and applies
   * the inner timeout (G3). Returns the tool's result or rejects with a typed error.
   */
  invoke(artifactId: string, name: string, args: Record<string, unknown>): Promise<unknown> {
    if (this.navFrozen) return Promise.reject(new Error("artifact_unavailable"));
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) return Promise.reject(new Error("artifact_gone"));
    const tool = artifact.tools.get(name);
    if (!tool) return Promise.reject(new Error("artifact_unknown_tool"));
    const validation = validateArgs(args ?? {}, tool.inputSchema);
    if (!validation.ok) return Promise.reject(new Error(`artifact_bad_args: ${validation.error}`));
    const callId = `acall-${Date.now()}-${++this.callSeq}`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = this.setTimer(() => {
        this.pending.delete(callId);
        reject(new Error("artifact_invoke_timeout"));
      }, INNER_INVOKE_TIMEOUT_MS);
      this.pending.set(callId, { resolve, reject, timer, artifactId });
      const posted = this.host.postToArtifact(artifactId, { type: "my-ax:artifact-invoke", callId, name, args: validation.args });
      if (!posted) {
        this.clearTimer(timer);
        this.pending.delete(callId);
        reject(new Error("artifact_gone"));
      }
    });
  }
}

// ── bounded validators ────────────────────────────────────────────────
function sanitizeSchema(schema: unknown): ArtifactToolSchema | undefined {
  if (!schema || typeof schema !== "object") return undefined;
  const out: ArtifactToolSchema = {};
  let n = 0;
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (n++ >= 16) break;
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(k)) continue;
    if (v === "string" || v === "number" || v === "boolean" || v === "string?" || v === "number?" || v === "boolean?") out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** G5: validate args against the registered schema. No extra keys, types match,
 *  required (non-?) keys present, strings bounded. Returns the cleaned args. */
export function validateArgs(args: Record<string, unknown>, schema?: ArtifactToolSchema): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  if (!schema) {
    // No schema declared -> accept only an empty/absent arg object (fail closed).
    if (args && Object.keys(args).length > 0) return { ok: false, error: "no schema declared but args provided" };
    return { ok: true, args: {} };
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(args ?? {})) {
    if (!(key in schema)) return { ok: false, error: `unexpected key: ${key}` };
  }
  for (const [key, type] of Object.entries(schema)) {
    const optional = type.endsWith("?");
    const base = optional ? type.slice(0, -1) : type;
    const has = args != null && key in args;
    if (!has) { if (optional) continue; return { ok: false, error: `missing key: ${key}` }; }
    const val = args[key];
    if (base === "string") { if (typeof val !== "string") return { ok: false, error: `${key} must be string` }; if (val.length > MAX_STRING_ARG) return { ok: false, error: `${key} too long` }; }
    else if (base === "number") { if (typeof val !== "number" || !Number.isFinite(val)) return { ok: false, error: `${key} must be number` }; }
    else if (base === "boolean") { if (typeof val !== "boolean") return { ok: false, error: `${key} must be boolean` }; }
    out[key] = val;
  }
  return { ok: true, args: out };
}
