// Shared Svelte 5 store for my-ax.
//
// .svelte.ts modules can use $state/$derived runes at module scope. Every
// component that imports from here sees the same underlying state, with
// Svelte's signal-style reactivity propagating across panel boundaries.
//
// Why module-level state and not contexts:
//   - panels mount independently (each in its own svelte-hono embed); they
//     don't share a single component tree to thread context through.
//   - browser-singleton state (active model, WS conn) maps cleanly to module
//     singletons. The store is loaded once into the shared runtime bundle
//     when the FIRST panel imports from it.

// ─── Identity & session ────────────────────────────────────────────────────
export const SESSION_KEY = "my-ax-session-id";
export const RESUME_SESSION_ONCE_KEY = "my-ax-resume-session-once";
export const FIRST_SEND_SESSION_ONCE_KEY = "my-ax-first-send-session-once";

function initialSessionId(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(SESSION_KEY);
}
function storedSessionTitle(id: string | null): string | null {
  if (!id || typeof localStorage === "undefined") return null;
  return localStorage.getItem(`my-ax-session-title:${id}`);
}
const initialActiveSessionId = initialSessionId();
export const sessionState = $state({
  id: initialActiveSessionId,
  title: storedSessionTitle(initialActiveSessionId) || (initialActiveSessionId ? `Session ${initialActiveSessionId.slice(0, 8)}` : "New conversation"),
});
// Monotonic epoch bumped on every title-affecting change (id change or a
// local title write). Async title refreshes capture the epoch before their
// fetch and drop their result if a newer local title landed meanwhile, so a
// slow server list cannot clobber a fresh rename/fork title.
let sessionTitleEpoch = 0;
export function captureTitleEpoch(): number { return sessionTitleEpoch; }
export function isTitleEpochCurrent(epoch: number): boolean { return epoch === sessionTitleEpoch; }
export function setActiveSession(id: string | null, title?: string | null) {
  const nextTitle = title?.trim();
  sessionTitleEpoch += 1;
  sessionState.id = id;
  sessionState.title = nextTitle || storedSessionTitle(id) || (id ? `Session ${id.slice(0, 8)}` : "New conversation");
  if (id && nextTitle) try { localStorage.setItem(`my-ax-session-title:${id}`, nextTitle); } catch {}
}

// ─── Model + reasoning state ───────────────────────────────────────────────
export type Reasoning = "low" | "medium" | "high";

interface ModelEntry {
  id: string;
  label: string;
  reasoning: boolean;
}

// Initial values come from localStorage (set by the user previously) or the
// SSR-rendered initial select option. Each component's onMount syncs to
// these as needed.
function initialModel(): string {
  if (typeof localStorage === "undefined") return "@cf/moonshotai/kimi-k2.7-code";
  return localStorage.getItem("model") || "@cf/moonshotai/kimi-k2.7-code";
}
function initialReasoning(): Reasoning {
  if (typeof localStorage === "undefined") return "medium";
  const v = localStorage.getItem("reasoning");
  if (v === "low" || v === "medium" || v === "high") return v;
  return "medium";
}

// Module-level $state. Imported by every panel that touches model/reasoning.
export const modelState = $state({
  current: initialModel(),
  reasoning: initialReasoning(),
  // Augmented when the model-catalog search returns hits. Maps id -> entry.
  // Used to (re)label dropdowns when a previously-unknown model is picked.
  catalog: new Map<string, ModelEntry>(),
});

export function setModel(id: string, label?: string, supportsReasoning?: boolean) {
  modelState.current = id;
  if (label || supportsReasoning !== undefined) {
    const entry: ModelEntry = {
      id,
      label: label ?? id,
      reasoning: supportsReasoning ?? false,
    };
    modelState.catalog.set(id, entry);
  }
  try {
    localStorage.setItem("model", id);
  } catch {}
}
export function setReasoning(v: Reasoning) {
  modelState.reasoning = v;
  try {
    localStorage.setItem("reasoning", v);
  } catch {}
}

// ─── Connection + agent status ─────────────────────────────────────────────
export type ConnState = "offline" | "reconnecting" | "live";
export type AgentStatus = "idle" | "thinking" | "running" | "done";

export const wsState = $state({
  conn: "offline" as ConnState,
  status: "idle" as AgentStatus,
});

export function setConn(state: ConnState) {
  wsState.conn = state;
}
export function setStatus(s: AgentStatus) {
  wsState.status = s;
}

// ─── WebSocket bridge ──────────────────────────────────────────────────────
// Chat.svelte owns the WebSocket lifetime. Other components that need to
// send something (eg. cancel a turn) call wsSend; if the socket isn't OPEN
// the message is queued and flushed on the next "open" event.
let socket: WebSocket | null = null;
let socketTarget = new EventTarget();
const sendQueue: string[] = [];

export function attachSocket(s: WebSocket) {
  socket = s;
}
export function detachSocket() {
  socket = null;
}
export function wsSend(payload: unknown) {
  const msg = typeof payload === "string" ? payload : JSON.stringify(payload);
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(msg);
  } else {
    sendQueue.push(msg);
  }
}
export function flushQueue() {
  while (sendQueue.length && socket && socket.readyState === WebSocket.OPEN) {
    socket.send(sendQueue.shift()!);
  }
}
export function onSocketMessage(handler: (data: string) => void) {
  const fn = (e: Event) => handler((e as MessageEvent).data);
  socketTarget.addEventListener("message", fn);
  return () => socketTarget.removeEventListener("message", fn);
}
export function emitSocketMessage(data: string) {
  socketTarget.dispatchEvent(new MessageEvent("message", { data }));
}

// ─── Toast / error / system message bus ───────────────────────────────────
// Chat.svelte renders these; other components publish into them.
export interface ChatToast {
  id: string;
  kind: "system" | "error";
  text: string;
}
export const toastBus = $state({
  pending: [] as ChatToast[],
});
let toastCounter = 0;
export function pushSystem(text: string) {
  toastBus.pending = [
    ...toastBus.pending,
    { id: `toast-${++toastCounter}`, kind: "system", text },
  ];
}
export function pushError(text: string) {
  toastBus.pending = [
    ...toastBus.pending,
    { id: `toast-${++toastCounter}`, kind: "error", text },
  ];
}
export function clearToast(id: string) {
  toastBus.pending = toastBus.pending.filter((t) => t.id !== id);
}

// ─── Theme (system/light/dark) ────────────────────────────────────────────
export type ThemePref = "system" | "light" | "dark";

export const themeState = $state({
  pref: "system" as ThemePref,
});

export function applyTheme(pref: ThemePref) {
  themeState.pref = pref;
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  const concrete =
    pref === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : pref;
  html.classList.toggle("dark", concrete === "dark");
  html.classList.toggle("light", concrete === "light");
  html.dataset.themePref = pref;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) (meta as HTMLMetaElement).content = concrete === "light" ? "#ffffff" : "#0a0a0a";
}

// ─── Connector reauth signaling ───────────────────────────────────────────
// chat stream emits {type:"my_ax_connector_reauth", server} when an upstream
// MCP server needs reauthorization. Connectors panel & in-chat banner both
// listen on this signal.
export const reauthState = $state({
  needs: new Set<string>(),
  active: null as { server: string } | null,
});
export function markReauth(server: string) {
  reauthState.needs.add(server);
  reauthState.active = { server };
}
export function clearReauth() {
  reauthState.active = null;
  reauthState.needs = new Set();
}
