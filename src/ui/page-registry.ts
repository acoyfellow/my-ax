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
  pushState?: (artifactId: string, state: unknown) => boolean;
}
let artifactBridge: ArtifactBridge | null = null;
export function setArtifactBridge(bridge: ArtifactBridge | null): void { artifactBridge = bridge; }

export function sessionArgument(args: Record<string, unknown>): string {
  const candidate = args.id ?? args.sessionId;
  return typeof candidate === "string" || typeof candidate === "number" ? String(candidate).trim() : "";
}

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
      return { result: list.map((s: any) => ({ id: s.id, title: s.title ?? s.name ?? null, status: s.status ?? null, updatedAt: s.updatedAt ?? s.updated_at ?? null })) };
    },
  },
  {
    name: "readHealth",
    description: "Read workspace container health: {diskPct,files,version,region,...}. Prefer readVersion for deploy freshness; this path waits on the sandbox.",
    resolution: "receipt",
    run: async () => {
      const data = (await getJSON(`/api/system`)) as { result?: unknown };
      return { result: data?.result ?? data };
    },
  },
  {
    name: "readVersion",
    description: "Read the live client build vs the Worker deploy: {clientId,clientTimestamp,deployedId,deployedTimestamp,fresh,stale}. Uses /api/version (no sandbox).",
    resolution: "receipt",
    run: async () => {
      const client = (window as any).__MY_AX_DEPLOY__ ?? { id: null, timestamp: null };
      const res = await fetch("/api/version", { cache: "no-store", credentials: "same-origin" });
      const deployedId = res.headers.get("X-My-Ax-Version");
      const deployedTimestamp = res.headers.get("X-My-Ax-Version-Timestamp");
      const clientId = typeof client.id === "string" && client.id ? client.id : null;
      const fresh = Boolean(clientId && deployedId && clientId === deployedId);
      return { result: {
        clientId,
        clientTimestamp: typeof client.timestamp === "string" ? client.timestamp : null,
        deployedId,
        deployedTimestamp,
        fresh,
        stale: Boolean(clientId && deployedId && clientId !== deployedId),
        httpStatus: res.status,
      } };
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
    name: "readViewport",
    description: "Read the live top-document viewport and the .app-viewport frame gap (read-only): {innerWidth,innerHeight,visualWidth,visualHeight,visualOffsetTop,visualScale,dvh,safeAreaTop,safeAreaBottom,appViewportRect,gapBelow,devicePixelRatio,userAgent,platform,uaMobile,maxTouchPoints,standalone}.",
    resolution: "receipt",
    run: async () => {
      const vv = window.visualViewport;
      const innerWidth = window.innerWidth;
      const innerHeight = window.innerHeight;
      const dvh = document.documentElement.clientHeight;
      const readInset = (name: string) => {
        const probe = document.createElement("div");
        probe.style.cssText = `position:fixed;height:env(${name});width:0;visibility:hidden;pointer-events:none`;
        document.body.appendChild(probe);
        const px = Number.parseFloat(getComputedStyle(probe).height) || 0;
        probe.remove();
        return px;
      };
      const el = document.querySelector(".app-viewport");
      const r = el ? el.getBoundingClientRect() : null;
      const appViewportRect = r ? { top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom } : null;
      return { result: {
        innerWidth,
        innerHeight,
        visualWidth: vv?.width ?? innerWidth,
        visualHeight: vv?.height ?? innerHeight,
        visualOffsetTop: vv?.offsetTop ?? 0,
        visualScale: vv?.scale ?? 1,
        dvh,
        safeAreaTop: readInset("safe-area-inset-top"),
        safeAreaBottom: readInset("safe-area-inset-bottom"),
        appViewportRect,
        gapBelow: appViewportRect ? Math.max(0, innerHeight - appViewportRect.bottom) : null,
        devicePixelRatio: window.devicePixelRatio,
        userAgent: navigator.userAgent,
        platform: (navigator as any).userAgentData?.platform ?? navigator.platform ?? "",
        uaMobile: (navigator as any).userAgentData?.mobile ?? null,
        maxTouchPoints: navigator.maxTouchPoints ?? 0,
        standalone: (window.matchMedia?.("(display-mode: standalone)")?.matches ?? false) || Boolean((navigator as any).standalone),
      } };
    },
  },
  {
    name: "setViewportDebug",
    description: "Toggle the on-screen viewport debug overlay in the owner's live UI (works in the installed PWA where a URL query cannot). Input: {on: boolean}. Draws the app-frame edges, the safe-area-inset-bottom band, the screen-bottom line, and live viewport numbers, then returns the current readViewport metrics so the overlay and the numbers agree.",
    resolution: "receipt",
    run: async (args) => {
      const on = args?.on === undefined ? true : Boolean(args.on);
      try {
        if (on) localStorage.setItem("my-ax-vpdebug", "1");
        else localStorage.removeItem("my-ax-vpdebug");
      } catch {}
      window.dispatchEvent(new CustomEvent("my-ax:vpdebug", { detail: { on } }));
      const vv = window.visualViewport;
      const innerHeight = window.innerHeight;
      const readInset = (name: string) => {
        const probe = document.createElement("div");
        probe.style.cssText = `position:fixed;height:env(${name});width:0;visibility:hidden;pointer-events:none`;
        document.body.appendChild(probe);
        const px = Number.parseFloat(getComputedStyle(probe).height) || 0;
        probe.remove();
        return px;
      };
      const el = document.querySelector(".app-viewport");
      const r = el ? el.getBoundingClientRect() : null;
      return { result: {
        on,
        innerHeight,
        visualHeight: vv?.height ?? innerHeight,
        dvh: document.documentElement.clientHeight,
        safeAreaBottom: readInset("safe-area-inset-bottom"),
        appViewportBottom: r ? r.bottom : null,
        gapBelow: r ? Math.max(0, innerHeight - r.bottom) : null,
        standalone: (window.matchMedia?.("(display-mode: standalone)")?.matches ?? false) || Boolean((navigator as any).standalone),
      } };
    },
  },
  {
    name: "switchSession",
    description: "Switch the active conversation. Input: {id} or {sessionId}, as returned by listSessions. Resolves on the client's switch ack.",
    resolution: "ack",
    run: async (args) => {
      const id = sessionArgument(args);
      if (!id) throw new Error("switchSession requires {id} or {sessionId}");
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
    name: "openTerminal",
    description: "Show a compact on-demand terminal card in this conversation. The pty stays in the background until this is called.",
    resolution: "receipt",
    run: async () => {
      window.dispatchEvent(new Event("my-ax:terminal-open"));
      return { result: { ok: true, shown: true } };
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
    name: "reload",
    description: "Hard-reload the owner's live UI (installed iOS PWA included): skipWaiting + cache-bust replace. Resolves after the reload event is dispatched.",
    resolution: "ack",
    run: async () => {
      return {
        result: { ok: true, reloading: true },
        after: () => { window.dispatchEvent(new Event("my-ax:reload")); },
      };
    },
  },
  {
    name: "navigate",
    description: "Navigate the owner's UI to an in-app deep link (e.g. /?session=<id>, /?action=attention, /?action=settings, /?action=desk, /runs/<id>). Input: {target}. Resolves on the client's navigate ack.",
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
  {
    name: "deskRead",
    description: "Read the owner's desk state: the agent-authored app payload plus its artifactId. Input: {}.",
    resolution: "receipt",
    run: async () => {
      const data = (await getJSON("/api/desk/app")) as { result?: unknown };
      return { result: data?.result ?? null };
    },
  },
  {
    name: "deskWrite",
    description: "Write the owner's desk state. Input: {state} as a JSON string, or {artifactId} to point the desk at an agent-authored app. Concurrent writers are merged server-side.",
    resolution: "receipt",
    run: async (args) => {
      const payload: Record<string, unknown> = {};
      if (typeof args.artifactId === "string" && args.artifactId) payload.artifactId = args.artifactId;
      if (typeof args.state === "string" && args.state) {
        try { payload.state = JSON.parse(args.state); } catch { throw new Error("deskWrite state must be a JSON string"); }
      }
      if (!Object.keys(payload).length) throw new Error("deskWrite requires {state} or {artifactId}");
      const response = await fetch("/api/desk/app", {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(`/api/desk -> ${response.status}`);
      const body = (await response.json()) as { result?: unknown };
      return { result: body?.result ?? null };
    },
  },
  {
    name: "sendToSession",
    description: "Send a message to one of the owner's conversations without switching to it. Input: {sessionId} or {id}, plus {content}.",
    resolution: "receipt",
    run: async (args) => {
      const sessionId = sessionArgument(args);
      const content = String(args.content ?? "").slice(0, 4000).trim();
      if (!sessionId || !content) throw new Error("sendToSession requires {sessionId} or {id}, plus {content}");
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/inject`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!response.ok) throw new Error(`inject -> ${response.status}`);
      const body = (await response.json()) as { result?: unknown };
      return { result: body?.result ?? { sent: true } };
    },
  },
  {
    name: "openDesk",
    description: "Open the owner's durable desk board (/?action=desk).",
    resolution: "receipt",
    run: async () => {
      window.dispatchEvent(new Event("my-ax:desk-open"));
      return { result: { ok: true } };
    },
  },
  {
    name: "applyDeskBoard",
    description: "Replace the live desk panel with one owner board payload.",
    resolution: "receipt",
    run: async (args) => {
      window.dispatchEvent(new CustomEvent("my-ax:desk-board", { detail: args.board ?? args }));
      return { result: { ok: true } };
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
