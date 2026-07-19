// page-registry.ts — the client half of the `page.*` codemode connector.
//
// The server-side agent (my.ax Durable Object) drives the LIVE browser UI over
// the EXISTING chat WebSocket. The DO sends a `page_call` frame
// ({ requestId, verb, args }); this module executes the verb against the live
// page and replies with a `page_result` frame ({ requestId, ok, result|error }).
//
// SECURITY: this is a CURATED, capability-scoped verb registry. Each verb maps
// 1:1 onto an action the page already exposes today (a window event or a REST
// read the page already performs) — so this adds ZERO new capability surface.
// There is deliberately NO generic "run arbitrary DOM" verb here; arbitrary UI
// generation stays in the sandboxed artifact iframe. Every write verb is exactly
// the set already reachable via the window-event bus.
//
// Reuse-by-copy from echo: the requestId correlation + bounded-result shape.
// Unlike echo we do NOT need a Worker Loader sandbox on the client for these
// curated verbs — they are a fixed allowlist, not agent-authored code.

export type PageVerbResult = { ok: true; result: unknown } | { ok: false; error: string };

export interface PageCallFrame {
  type: "page_call";
  requestId: string;
  verb: string;
  args?: Record<string, unknown>;
}

export interface PageResultFrame {
  type: "page_result";
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

// One verb: a bounded async fn. `resolution` documents (for the catalog/agent)
// whether the DO should resolve on ack (write verbs that fire a UI event and
// wait for its -ack) or on client receipt (pure reads / fire-and-forget).
// A verb returns its result plus, optionally, an `after` side-effect that the
// caller runs AFTER the page_result frame has been flushed. This matters for
// disruptive verbs (e.g. switchSession) whose side-effect tears down the very
// socket the result must travel on: reply first, then act.
export interface PageVerbOutcome {
  result: unknown;
  after?: () => void;
}

export interface PageVerb {
  name: string;
  description: string;
  resolution: "ack" | "receipt";
  run: (args: Record<string, unknown>) => Promise<PageVerbOutcome>;
}

// Artifact-tool bridge (page connector v2). Chat.svelte owns the real
// ArtifactToolRegistry (it lives where the iframes are); it injects these two
// hooks so the curated page verbs can discover + invoke artifact-proposed tools
// WITHOUT those tools polluting the base allowlist or work_search (G4).
export interface ArtifactBridge {
  listTools: () => Array<{ artifactId: string; name: string; description: string }>;
  invokeTool: (artifactId: string, name: string, args: Record<string, unknown>) => Promise<unknown>;
}
let artifactBridge: ArtifactBridge | null = null;
export function setArtifactBridge(bridge: ArtifactBridge | null): void { artifactBridge = bridge; }

async function getJSON(url: string): Promise<unknown> {
  const r = await fetch(url, { credentials: "include", headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

// v1 curated verb catalog. Each maps onto an existing page capability.
export const PAGE_VERBS: PageVerb[] = [
  {
    name: "listSessions",
    description: "List the owner's recent conversations: [{id,title,status,updatedAt}].",
    resolution: "receipt",
    run: async (args) => {
      const limit = Math.min(Math.max(Number(args.limit) || 30, 1), 100);
      // The REST envelope wraps payloads in { ok, command, result }.
      const data = (await getJSON(`/api/sessions?limit=${limit}`)) as { result?: { sessions?: unknown[] }; sessions?: unknown[] };
      const rows = data?.result?.sessions ?? data?.sessions ?? [];
      const list = Array.isArray(rows) ? rows : [];
      return { result: list.map((s: any) => ({ id: s.id, title: s.title ?? null, status: s.status ?? null, updatedAt: s.updatedAt ?? s.updated_at ?? null })) };
    },
  },
  {
    name: "readHealth",
    description: "Read workspace container health: {diskPct,files,version,region,...}.",
    resolution: "receipt",
    run: async () => {
      const data = (await getJSON(`/api/system`)) as { result?: unknown };
      return { result: data?.result ?? data };
    },
  },
  {
    name: "readTranscriptTail",
    description: "Read the last N entries of the active conversation: [{role,text,ts}] (read-only).",
    resolution: "receipt",
    run: async (args) => {
      const n = Math.min(Math.max(Number(args.n) || 20, 1), 100);
      const nodes = [...document.querySelectorAll('main[aria-label="Conversation"] .msg')].slice(-n);
      return { result: nodes.map((el) => ({
        role: el.classList.contains("msg-user") ? "user" : "assistant",
        text: (el.querySelector(".msg-body")?.textContent ?? el.textContent ?? "").trim().slice(0, 4000),
        ts: el.getAttribute("data-ts") ?? null,
      })) };
    },
  },
  {
    name: "switchSession",
    description: "Switch the active conversation to {id}. Resolves on the client's switch ack.",
    resolution: "ack",
    run: async (args) => {
      const id = String(args.id ?? "");
      if (!id) throw new Error("switchSession requires {id}");
      // Disruptive: the switch tears down this very socket. Reply FIRST
      // (return the result), then perform the switch in `after` once the
      // page_result frame has been flushed to the awaiting DO.
      return {
        result: { ok: true, id },
        after: () => { window.dispatchEvent(new CustomEvent("my-ax:switch-session", { detail: { id } })); },
      };
    },
  },
  {
    name: "openSettings",
    description: "Open the settings dialog, optionally to {section}.",
    resolution: "receipt",
    run: async (args) => {
      const section = args.section ? String(args.section) : undefined;
      window.dispatchEvent(new CustomEvent("my-ax:settings-open", section ? { detail: { section } } : undefined));
      return { result: { ok: true, section: section ?? null } };
    },
  },
  {
    name: "openAttention",
    description: "Open the notifications/attention panel.",
    resolution: "receipt",
    run: async () => {
      window.dispatchEvent(new Event("my-ax:attention-open"));
      return { result: { ok: true } };
    },
  },
  {
    name: "openSessions",
    description: "Open the conversations sidebar.",
    resolution: "receipt",
    run: async () => {
      window.dispatchEvent(new Event("my-ax:sessions-open"));
      return { result: { ok: true } };
    },
  },
  {
    name: "notify",
    description: "Show a transient in-app notice (toast) to the owner in the live UI. Input: {text, kind?: 'system'|'error'}.",
    resolution: "receipt",
    run: async (args) => {
      const text = String(args.text ?? "").slice(0, 500);
      if (!text) throw new Error("notify requires {text}");
      const kind = args.kind === "error" ? "error" : "system";
      window.dispatchEvent(new CustomEvent("my-ax:toast", { detail: { text, kind } }));
      return { result: { ok: true } };
    },
  },
  {
    name: "navigate",
    description: "Navigate the owner's UI to an in-app deep link (e.g. /?session=<id>, /?action=attention, /?action=settings, /runs/<id>). Input: {target}. Resolves on the client's navigate ack.",
    resolution: "ack",
    run: async (args) => {
      const target = String(args.target ?? "").trim();
      if (!target) throw new Error("navigate requires {target}");
      // Disruptive: a session/full navigation can tear down this socket. Reply
      // FIRST, then dispatch the deep-link in `after` (same pattern as switchSession).
      return {
        result: { ok: true, target },
        after: () => { window.dispatchEvent(new CustomEvent("my-ax:navigate", { detail: { href: target } })); },
      };
    },
  },
  {
    name: "listArtifactTools",
    description: "List tools that live artifact widgets have self-registered: [{artifactId,name,description}]. These are NOT in work_search; discover them here, then call invokeArtifactTool.",
    resolution: "receipt",
    run: async () => {
      return { result: artifactBridge ? artifactBridge.listTools() : [] };
    },
  },
  {
    name: "invokeArtifactTool",
    description: "Invoke a tool a live artifact widget self-registered. Input: {artifactId, name, args?}. Parent-mediated + arg-validated; errors artifact_gone/artifact_unknown_tool/artifact_bad_args/artifact_invoke_timeout.",
    resolution: "receipt",
    run: async (args) => {
      if (!artifactBridge) throw new Error("artifact_bridge_unavailable");
      const artifactId = String(args.artifactId ?? "");
      const name = String(args.name ?? "");
      if (!artifactId || !name) throw new Error("invokeArtifactTool requires {artifactId, name}");
      const toolArgs = (args.args && typeof args.args === "object") ? args.args as Record<string, unknown> : {};
      const result = await artifactBridge.invokeTool(artifactId, name, toolArgs);
      return { result };
    },
  },
];

export function pageVerbCatalog() {
  return PAGE_VERBS.map((v) => ({ name: v.name, description: v.description, resolution: v.resolution }));
}

/**
 * Handle one inbound `page_call` frame. Returns the `page_result` frame to send
 * back over the WS, plus an optional `after` side-effect the caller MUST run
 * only after that frame is flushed (for disruptive verbs like switchSession).
 * Never throws — errors become { ok:false }.
 */
export async function handlePageCall(frame: PageCallFrame): Promise<{ frame: PageResultFrame; after?: () => void }> {
  const verb = PAGE_VERBS.find((v) => v.name === frame.verb);
  if (!verb) {
    return { frame: { type: "page_result", requestId: frame.requestId, ok: false, error: `unknown page verb: ${frame.verb}` } };
  }
  try {
    const outcome = await verb.run(frame.args ?? {});
    return { frame: { type: "page_result", requestId: frame.requestId, ok: true, result: outcome.result }, after: outcome.after };
  } catch (e) {
    return { frame: { type: "page_result", requestId: frame.requestId, ok: false, error: String(e instanceof Error ? e.message : e) } };
  }
}
