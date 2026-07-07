<script lang="ts">
  // Canonical conversation UI and browser runtime: transport recovery,
  // transcript rendering, composer, attachments, voice, and tool results.

  import { onMount, tick } from "svelte";
  import { marked } from "marked";
  import { VoiceClient } from "@cloudflare/voice/client";
  import ToolResultWidget from "./ToolResultWidget.svelte";
  import { resolveToolResultWidget, selectVisibleReusableToolCandidates, type CandidateReceipt } from "./tool-result-widgets";
  import { parseMyAxDeepLink, type MyAxDeepLink } from "./deep-links";
  import { SessionGenerationGuard, type SessionGeneration } from "./session-generation";
  import { loadCurrentSessionEntries, shouldReportEmptyRestore, type RestoreOutcome } from "./session-history";
  import { createReconnectingSocket } from "./reconnecting-socket";
  import {
    agentStatusFor,
    idleStreamingTurnState,
    isComposerLocked,
    transition as transitionStreamingTurn,
    type StreamingTurnEvent,
    type StreamingTurnState,
  } from "./streaming-turn-fsm";
  import {
    setConn,
    setStatus,
    wsState,
    modelState,
    setModel,
    pushSystem,
    pushError,
    toastBus,
    clearToast,
    SESSION_KEY,
    RESUME_SESSION_ONCE_KEY,
    FIRST_SEND_SESSION_ONCE_KEY,
    setActiveSession,
  } from "@my-ax/store";

  // Markdown ships in the application bundle so the first streamed token can
  // be parsed immediately. Syntax highlighting remains a lazy enhancement.
  marked.setOptions({ gfm: true, breaks: true });
  let hljs: any = null;
  async function ensureMarkedHljs() {
    if (hljs) return;
    const hljsMod = await import("https://esm.sh/highlight.js@11.10.0/lib/core");
    const langs = await Promise.all([
      import("https://esm.sh/highlight.js@11.10.0/lib/languages/javascript"),
      import("https://esm.sh/highlight.js@11.10.0/lib/languages/typescript"),
      import("https://esm.sh/highlight.js@11.10.0/lib/languages/python"),
      import("https://esm.sh/highlight.js@11.10.0/lib/languages/bash"),
      import("https://esm.sh/highlight.js@11.10.0/lib/languages/json"),
      import("https://esm.sh/highlight.js@11.10.0/lib/languages/xml"),
      import("https://esm.sh/highlight.js@11.10.0/lib/languages/css"),
      import("https://esm.sh/highlight.js@11.10.0/lib/languages/yaml"),
      import("https://esm.sh/highlight.js@11.10.0/lib/languages/markdown"),
    ]);
    hljs = hljsMod.default;
    const reg = (name: string, mod: any) => hljs.registerLanguage(name, mod.default);
    reg("javascript", langs[0]);
    reg("typescript", langs[1]);
    reg("python", langs[2]);
    reg("bash", langs[3]);
    reg("sh", langs[3]);
    reg("shell", langs[3]);
    reg("json", langs[4]);
    reg("xml", langs[5]);
    reg("html", langs[5]);
    reg("css", langs[6]);
    reg("yaml", langs[7]);
    reg("yml", langs[7]);
    reg("md", langs[8]);
    reg("markdown", langs[8]);
    // hljs github-dark theme stylesheet — Chrome forbids MIME-mismatched CSS
    // ES imports, so we use a <link> tag.
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://esm.sh/highlight.js@11.10.0/styles/github-dark.css";
    document.head.appendChild(link);
  }

  // ── State ──────────────────────────────────────────────────────────
  type Role = "user" | "assistant" | "system" | "error" | "tool";

  interface Attachment {
    key: string;
    name?: string;
    mime?: string;
    thumbnail?: string;
  }
  interface ToolCallView {
    id: string;
    name: string;
    arguments: any;
    state: "pending" | "done" | "error";
    startedAt: number;
    elapsedText: string;
    result?: any;
    isError?: boolean;
  }
  // Each assistant message renders a CHRONOLOGICAL sequence of parts so
  // text and tool calls interleave in the order the model produced them.
  // The old shape (single content string + toolCalls[]) rendered all
  // text before all tools, which surfaced 'DONE' before the write call.
  type Part =
    | { kind: "text"; text: string; rendered?: string }
    | { kind: "tool"; tool: ToolCallView };
  // Render block: a standalone text part, or a RUN of consecutive tool parts
  // grouped into one container so back-to-back tool calls share a single
  // bordered card instead of stacking N separate boxes.
  type RenderBlock =
    | { kind: "text"; text: string; rendered?: string }
    | { kind: "tools"; tools: ToolCallView[] };
  // Per-tool open/closed state, keyed by tool id, so a stream re-render never
  // slams a tool a user manually opened. We only auto-decide the FIRST time we
  // see a tool (default: open finished non-raw results; leave running ones
  // closed). After that the user's toggle is authoritative.
  const toolOpen = $state<Record<string, boolean>>({});
  function toolIsOpen(tool: ToolCallView, widgetKind: string): boolean {
    if (tool.id in toolOpen) return toolOpen[tool.id];
    return tool.state !== "pending" && widgetKind !== "raw-text";
  }
  function setToolOpen(id: string, open: boolean) {
    if (toolOpen[id] !== open) toolOpen[id] = open;
  }

  function groupParts(parts: Part[]): RenderBlock[] {
    const blocks: RenderBlock[] = [];
    for (const part of parts) {
      if (part.kind === "text") {
        blocks.push({ kind: "text", text: part.text, rendered: part.rendered });
      } else {
        const last = blocks[blocks.length - 1];
        if (last && last.kind === "tools") last.tools.push(part.tool);
        else blocks.push({ kind: "tools", tools: [part.tool] });
      }
    }
    return blocks;
  }

  // Reusable-tool candidate receipts are noisy when the model re-runs the same
  // work_code call — every run emits an identical card. Within the currently
  // loaded conversation, keep only the newest card per fingerprint; older
  // occurrences keep their receipt row but downgrade to the ordinary inert
  // raw-text preview so a second card never appears. Historical results
  // without the metadata continue to render whatever they resolve to.
  const visibleReusableCandidateIds = $derived.by<Set<string>>(() => {
    const receipts: CandidateReceipt[] = [];
    for (const message of messages) {
      if (message.role !== "assistant") continue;
      for (const part of message.parts) {
        if (part.kind !== "tool") continue;
        const tool = part.tool;
        if (tool.state !== "done") continue;
        const widget = resolveToolResultWidget(tool.result, tool.name);
        const fingerprint = widget.kind === "reusable-tool-candidate" ? widget.fingerprint : undefined;
        receipts.push({ id: tool.id, widgetKind: widget.kind, fingerprint });
      }
    }
    return selectVisibleReusableToolCandidates(receipts);
  });
  interface MessageView {
    id: string;
    clientMsgId?: string;
    role: Role;
    /** Plain text concatenation — used for user/system/error messages and
     *  for the optimistic display before any parts are populated. */
    content: string;
    /** Chronologically ordered text + tool parts. Assistant messages
     *  render `parts` if non-empty; otherwise fall back to `content`. */
    parts: Part[];
    reasoning?: string;
    attachments?: Attachment[];
    timestamp?: number;
    streaming: boolean;
    pending: boolean; // optimistic user message
  }

  let messages = $state<MessageView[]>([]);
  // Start behind a styled loading veil. On a fresh browser/PWA launch the
  // server — not localStorage — decides whether there is a latest owner
  // conversation to resume. This prevents the empty onboarding state from
  // flashing while bootstrap is still unresolved.
  let bootstrapPending = $state(true);
  let onboardingHidden = $state(false);
  let sessionResumeVisible = $state(false);
  let resumingExistingSession = $state(false);
  let thinkingVisible = $state(false);
  let scrollToBottomVisible = $state(false);
  let pendingDecision = $state<{ id: string; question: string; href: string } | null>(null);

  let logEl = $state<HTMLElement | undefined>(undefined);
  let inputEl = $state<HTMLTextAreaElement | undefined>(undefined);
  let composerText = $state("");
  let pendingAttachments = $state<Attachment[]>([]);

  // ── Realtime voice mode (same Think session) ─────────────────────
  // Replaces passive read-aloud: one persistent microphone/TTS call feeds
  // ordinary durable Think turns and lets the normal transcript stream behind it.
  type VoiceStatus = "idle" | "listening" | "thinking" | "speaking";
  let voiceEnabled = $state(false);
  let voiceStarting = $state(false);
  let voiceStatus = $state<VoiceStatus>("idle");
  let voiceInterim = $state<string | null>(null);
  let voiceAudioLevel = $state(0);
  let voiceError = $state<string | null>(null);
  let voiceClient: VoiceClient | null = null;

  function resetVoiceState() {
    voiceStarting = false;
    voiceStatus = "idle";
    voiceInterim = null;
    voiceAudioLevel = 0;
    voiceError = null;
  }

  async function stopVoiceMode() {
    voiceClient?.endCall();
    voiceClient?.disconnect();
    voiceClient = null;
    voiceEnabled = false;
    localStorage.setItem("my-ax-voice-mode", "0");
    resetVoiceState();
  }

  function startVoiceClientForSession(sessionId: string) {
    // Voice runs on its own DIRECT-routed DO (agent: "voice-think-agent"),
    // keyed by this session id. The facet socket that backs the chat (agent:
    // "my-agent") cannot carry the stock voice call lifecycle — see
    // docs/voice-mode-journey.md. The voice DO delegates each turn back into
    // the MyAgent facet by RPC, so the reply still lands in this session's
    // Think transcript and streams into the chat log via cf_agent_* frames.
    const client = new VoiceClient({ agent: "voice-think-agent", name: sessionId, host: location.host });
    client.addEventListener("statuschange", (status) => {
      voiceStatus = status;
      voiceStarting = false;
    });
    client.addEventListener("transcriptchange", () => {});
    client.addEventListener("interimtranscript", (text) => { voiceInterim = text; });
    client.addEventListener("audiolevelchange", (level) => { voiceAudioLevel = level; });
    client.addEventListener("error", (error) => { voiceError = error; if (error) pushError(`Voice mode: ${error}`); });
    client.addEventListener("metricschange", (metrics) => { if (metrics) console.info("[voice] pipeline metrics", metrics); });
    client.addEventListener("connectionchange", async (connected) => { if (connected && voiceEnabled) await client.startCall(); });
    voiceClient = client;
    voiceEnabled = true;
    localStorage.setItem("my-ax-voice-mode", "1");
    client.connect();
  }

  async function toggleVoiceMode() {
    if (voiceEnabled) {
      await stopVoiceMode();
      return;
    }
    // Paint immediately before any mic/AudioContext/network awaits. On iOS a
    // permission prompt or suspended audio call can otherwise make the tap
    // appear to do nothing until the app is foregrounded again.
    voiceStarting = true;
    voiceEnabled = true;
    voiceStatus = "idle";
    localStorage.setItem("my-ax-voice-mode", "1");
    // Acquire the mic permission SYNCHRONOUSLY inside this tap gesture, before
    // any network await. The VoiceClient otherwise calls getUserMedia on the
    // async `connectionchange` event — detached from the gesture — which on
    // iOS PWAs makes the prompt feel extra/repeated. We can't defeat iOS's
    // per-launch PWA permission reset (a WebKit limitation), but this keeps
    // the single prompt in-gesture and primes the grant before startCall().
    try {
      const warm = await navigator.mediaDevices?.getUserMedia({ audio: true });
      // Immediately release; VoiceClient re-acquires with its own constraints.
      // The fresh in-gesture grant means its getUserMedia resolves silently.
      warm?.getTracks().forEach((t) => t.stop());
    } catch (error) {
      await stopVoiceMode();
      pushError(`Microphone access is required for voice mode: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    await tick();
    let sessionId = localStorage.getItem(SESSION_KEY);
    if (!sessionId) {
      try { sessionId = await createSession(); }
      catch (error) { await stopVoiceMode(); pushError(`Could not start voice conversation: ${error instanceof Error ? error.message : String(error)}`); return; }
      localStorage.setItem(SESSION_KEY, sessionId);
      setActiveSession(sessionId);
      // Start immediately within this user gesture. The parallel voice socket
      // targets the newly-created Think facet; no full-page reload needed.
    }
    // Voice turns don't send a request body, so sync the UI-selected model
    // onto the session DO. CRITICAL: do NOT await this here — an await before
    // startCall() breaks the iOS user-gesture chain, leaving the AudioContext
    // suspended so TTS audio never plays. Fire-and-forget; the server also
    // self-heals stale models in onTurn as a backstop.
    void fetch(`/api/sessions/${encodeURIComponent(sessionId)}/model`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelState.current, reasoningEffort: modelState.reasoning }),
    }).catch(() => {});
    voiceStarting = false;
    startVoiceClientForSession(sessionId);
  }

  // Browser-native read-aloud (SpeechSynthesis) was removed when live voice
  // mode shipped. Voice mode (Workers AI STT/TTS over the Think socket) is the
  // single audio surface now — see docs/voice-mode-journey.md.

  // ── Status state machine ───────────────────────────────────────────
  // Wraps wsState.status to also drive the thinking indicator.
  let thinkingShowTimer: ReturnType<typeof setTimeout> | null = null;
  let thinkingInactivityTimer: ReturnType<typeof setTimeout> | null = null;
  const THINKING_SHOW_DELAY_MS = 200;
  const THINKING_INACTIVITY_MS = 600;
  let turnState = $state<StreamingTurnState>(idleStreamingTurnState);

  function dispatchTurn(event: StreamingTurnEvent) {
    const next = transitionStreamingTurn(turnState, event);
    turnState = next;
    if (next.tag !== "active") {
      applyStatus(agentStatusFor(next));
    }
    return next;
  }

  function showThinking() {
    thinkingVisible = true;
    const pinned = isLogPinned();
    if (pinned) queueScrollToBottom();
  }
  function hideThinking() {
    thinkingVisible = false;
  }
  function clearThinkingTimers() {
    if (thinkingShowTimer !== null) {
      clearTimeout(thinkingShowTimer);
      thinkingShowTimer = null;
    }
    if (thinkingInactivityTimer !== null) {
      clearTimeout(thinkingInactivityTimer);
      thinkingInactivityTimer = null;
    }
  }
  function noteAgentActivity() {
    hideThinking();
    if (thinkingInactivityTimer !== null) clearTimeout(thinkingInactivityTimer);
    thinkingInactivityTimer = setTimeout(() => {
      thinkingInactivityTimer = null;
      if (wsState.status !== "idle" && wsState.status !== "done") {
        showThinking();
      }
    }, THINKING_INACTIVITY_MS);
  }

  function applyStatus(s: "idle" | "thinking" | "running" | "done") {
    setStatus(s);
    if (s === "idle" || s === "done") {
      clearThinkingTimers();
      hideThinking();
    } else {
      if (thinkingShowTimer !== null) clearTimeout(thinkingShowTimer);
      thinkingShowTimer = setTimeout(() => {
        thinkingShowTimer = null;
        if (wsState.status !== "idle" && wsState.status !== "done") showThinking();
      }, THINKING_SHOW_DELAY_MS);
    }
  }

  // ── Composer derived ───────────────────────────────────────────────
  const composerLocked = $derived(
    isComposerLocked(turnState) || (wsState.status !== "idle" && wsState.status !== "done"),
  );
  const wsDown = $derived(wsState.conn !== "live");
  const sendStatus = $derived.by(() => {
    if (wsDown && !composerLocked) return "offline";
    if (composerLocked && wsState.status !== "done") return wsState.status;
    return "idle";
  });

  // Keep the phone display awake only while the user is actively watching a
  // foreground turn. This is display polish, not a background execution
  // contract: Think / DO scheduling remains server-side when the PWA sleeps.
  let wakeLockSentinel: any = null;
  async function syncWakeLock() {
    if (typeof document === "undefined" || typeof navigator === "undefined") return;
    const shouldHold = composerLocked && document.visibilityState === "visible" && "wakeLock" in navigator;
    if (shouldHold && !wakeLockSentinel) {
      try {
        wakeLockSentinel = await (navigator as any).wakeLock.request("screen");
        wakeLockSentinel.addEventListener?.("release", () => { wakeLockSentinel = null; });
      } catch {}
    } else if (!shouldHold && wakeLockSentinel) {
      const held = wakeLockSentinel;
      wakeLockSentinel = null;
      await held.release?.().catch?.(() => {});
    }
  }
  function sendVisibility() {
    if (ws && (ws as any).readyState === WebSocket.OPEN) {
      (ws as any).send(JSON.stringify({ type: "my_ax_visibility", visible: document.visibilityState === "visible" }));
    }
  }
  function onVisibilityChange() {
    void syncWakeLock();
    sendVisibility();
    // Mobile/PWA tabs can miss stream completion while backgrounded without a
    // useful close event. Ask Think to replay the active request when the user
    // returns so a durably completed reply replaces the stale loading state.
    if (document.visibilityState === "visible") {
      // A recovery request sent just before iOS froze the page may never have
      // reached the server. Do not let that stale latch suppress this retry.
      if (Date.now() - lastSocketActivityAt > 10_000) {
        responseRecoveryPending = false;
        dispatchTurn({ type: "visibility-stale" });
      }
      requestActiveResponseRecovery();
    }
  }
  $effect(() => {
    void composerLocked;
    void syncWakeLock();
  });
  // Rendering/recovery errors must never trap the user behind an infinite
  // session-loading veil. Normal history replay clears this immediately; this
  // is the fail-open UI guard that reveals whatever durable content exists.
  $effect(() => {
    if (!sessionResumeVisible) return;
    const timer = setTimeout(() => { sessionResumeVisible = false; }, 12_000);
    return () => clearTimeout(timer);
  });

  // ── Scroll helpers ─────────────────────────────────────────────────
  function isLogPinned() {
    if (!logEl) return true;
    return logEl.scrollHeight - logEl.clientHeight - logEl.scrollTop < 80;
  }
  function syncScrollToBottom() {
    scrollToBottomVisible = !isLogPinned();
  }
  function queueScrollToBottom() {
    if (!logEl) return;
    requestAnimationFrame(() => {
      if (logEl) logEl.scrollTop = logEl.scrollHeight;
      syncScrollToBottom();
    });
  }
  async function revealResumedHistoryAtBottom() {
    // Render history behind the loading veil, jump to the latest message with
    // smooth scrolling explicitly disabled, then reveal the conversation.
    // Fresh loads should already be at the bottom when the spinner disappears.
    await tick();
    if (logEl) {
      const previousBehavior = logEl.style.scrollBehavior;
      logEl.style.scrollBehavior = "auto";
      logEl.scrollTop = logEl.scrollHeight;
      syncScrollToBottom();
      requestAnimationFrame(() => {
        if (logEl) logEl.style.scrollBehavior = previousBehavior;
      });
    }
    sessionResumeVisible = false;
  }

  // ── Markdown render ────────────────────────────────────────────────
  function renderMarkdown(md: string): string {
    let html = marked.parse(md ?? "") as string;
    // post-process <pre><code> for hljs + copy button. We need to do this
    // on the rendered HTML, since we're returning a string for {@html}.
    if (hljs) {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = html;
      wrapper.querySelectorAll("pre > code").forEach((codeEl) => {
        const pre = codeEl.parentElement as HTMLPreElement;
        pre.classList.add("relative", "rounded-lg", "border", "border-line", "overflow-x-auto", "text-xs", "leading-relaxed");
        pre.style.background = "#0a0a0a";
        pre.style.color = "#e9e9ec";
        pre.style.padding = "12px 14px 12px 14px";
        const langMatch = (codeEl.className || "").match(/language-([\w-]+)/);
        if (langMatch && hljs.getLanguage(langMatch[1])) {
          try {
            codeEl.innerHTML = hljs.highlight(codeEl.textContent || "", { language: langMatch[1] }).value;
          } catch {}
        } else {
          try {
            codeEl.innerHTML = hljs.highlightAuto(codeEl.textContent || "").value;
          } catch {}
        }
        // copy button is added via DOM after-mount because it needs a click handler.
      });
      html = wrapper.innerHTML;
    }
    return html;
  }

  // After markdown HTML is injected via {@html}, attach copy buttons.
  function attachCopyButtons(container: HTMLElement) {
    container.querySelectorAll("pre").forEach((pre) => {
      if (pre.querySelector(".code-copy-btn")) return;
      const codeEl = pre.querySelector("code");
      if (!codeEl) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "code-copy-btn";
      btn.textContent = "copy";
      btn.addEventListener("click", () => {
        copyText(codeEl.textContent || "").then(
          () => {
            btn.textContent = "copied";
            setTimeout(() => (btn.textContent = "copy"), 1200);
          },
          () => {
            btn.textContent = "err";
          },
        );
      });
      pre.appendChild(btn);
    });
  }

  async function copyText(text: string) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }

  function messageMarkdown(message: MessageView): string {
    if (message.role !== "assistant") return message.content || "";
    if (!message.parts.length) return message.content || "";
    return message.parts.map((part) => {
      if (part.kind === "text") return part.text;
      const args = briefArgs(part.tool.arguments);
      const status = part.tool.state === "pending" ? "running" : part.tool.state;
      return `

[tool:${part.tool.name}${args ? ` ${args}` : ""} · ${status}]
`;
    }).join("").trim();
  }

  let copiedMessageId = $state<string | null>(null);
  let forkingMessageId = $state<string | null>(null);
  async function copyMessage(message: MessageView) {
    try {
      await copyText(messageMarkdown(message));
      copiedMessageId = message.id;
      setTimeout(() => { if (copiedMessageId === message.id) copiedMessageId = null; }, 1400);
    } catch (err) {
      pushError(`Copy failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Coerce a number | ISO string | Date into epoch millis, or undefined. */
  function toMillis(v: unknown): number | undefined {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (v instanceof Date) { const t = v.getTime(); return Number.isFinite(t) ? t : undefined; }
    if (typeof v === "string") { const t = Date.parse(v); return Number.isFinite(t) ? t : undefined; }
    return undefined;
  }

  function formatMsgTime(d: Date): string {
    if (!(d instanceof Date) || isNaN(d.getTime())) return "";
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    const h24 = d.getHours();
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    const mm = String(d.getMinutes()).padStart(2, "0");
    const period = h24 < 12 ? "am" : "pm";
    const time = `${h12}:${mm} ${period}`;
    if (sameDay) return time;
    const month = d.toLocaleString(undefined, { month: "short" });
    const day = d.getDate();
    return `${month} ${day} · ${time}`;
  }
  async function forkFromMessage(message: MessageView) {
    const sessionId = localStorage.getItem(SESSION_KEY);
    if (!sessionId || message.pending || message.streaming || forkingMessageId) return;
    forkingMessageId = message.id;
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/fork`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ atMessageId: message.id }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message || `Fork failed (${response.status})`);
      const forkId = body?.result?.sessionId;
      if (!forkId) throw new Error("Fork did not return a conversation ID");
      localStorage.setItem(SESSION_KEY, forkId);
      setActiveSession(forkId, body?.result?.name);
      sessionStorage.setItem(RESUME_SESSION_ONCE_KEY, "1");
      location.href = `/?session=${encodeURIComponent(forkId)}`;
    } catch (error) {
      pushError(error instanceof Error ? error.message : String(error));
      forkingMessageId = null;
    }
  }

  function formatElapsed(ms: number) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    if (totalSec < 60) return totalSec + "s";
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return m + "m" + String(s).padStart(2, "0") + "s";
  }
  function briefArgs(args: any) {
    try {
      const s = JSON.stringify(args);
      return s.length > 80 ? s.slice(0, 80) + "…" : s;
    } catch {
      return "";
    }
  }
  function historicalToolName(content: string) {
    return content.split("\n", 1)[0].replace(/^\[functions\.[^\]]+\]:\s*/, "").trim() || "tool result";
  }

  // ── Message helpers ────────────────────────────────────────────────
  function getOrCreateMessage(id: string, role: Role, init?: Partial<MessageView>): MessageView {
    let m = messages.find((x) => x.id === id);
    if (m) return m;
    onboardingHidden = true;
    m = {
      id,
      role,
      content: "",
      streaming: role === "assistant",
      pending: false,
      parts: [],
      timestamp: Date.now(),
      ...init,
    };
    const wasPinned = isLogPinned();
    messages = [...messages, m];
    if (wasPinned) queueScrollToBottom();
    return m;
  }

  function updateMessage(id: string, updater: (m: MessageView) => MessageView) {
    messages = messages.map((m) => (m.id === id ? updater(m) : m));
  }

  function appendDelta(id: string, delta: string) {
    let exists = messages.find((m) => m.id === id);
    if (!exists) {
      exists = getOrCreateMessage(id, "assistant", { streaming: true });
    }
    const wasPinned = isLogPinned();
    updateMessage(id, (m) => {
      // Append to the last text part; create a new one if the last part
      // was a tool call. This preserves the chronological narrative.
      const parts = [...m.parts];
      const lastIdx = parts.length - 1;
      if (lastIdx >= 0 && parts[lastIdx].kind === "text") {
        const text = (parts[lastIdx] as any).text + delta;
        parts[lastIdx] = { kind: "text", text, rendered: renderMarkdown(text) };
      } else {
        parts.push({ kind: "text", text: delta, rendered: renderMarkdown(delta) });
      }
      return {
        ...m,
        content: (m.content || "") + delta,
        parts,
        streaming: true,
      };
    });
    noteAgentActivity();
    if (wasPinned) queueScrollToBottom();
  }
  function appendReasoningDelta(id: string, delta: string) {
    let m = messages.find((x) => x.id === id);
    if (!m) m = getOrCreateMessage(id, "assistant");
    const wasPinned = isLogPinned();
    updateMessage(id, (msg) => ({
      ...msg,
      reasoning: (msg.reasoning || "") + delta,
    }));
    if (wasPinned) queueScrollToBottom();
  }
  function appendToolCall(messageId: string, tool: { id: string; name: string; arguments: any }) {
    let m = messages.find((x) => x.id === messageId);
    if (!m) m = getOrCreateMessage(messageId, "assistant");
    const tc: ToolCallView = {
      id: tool.id,
      name: tool.name,
      arguments: tool.arguments,
      state: "pending",
      startedAt: Date.now(),
      elapsedText: "0s",
    };
    updateMessage(messageId, (msg) => ({
      ...msg,
      parts: [...msg.parts, { kind: "tool", tool: tc }],
    }));
    noteAgentActivity();
  }
  function attachToolResult(messageId: string, result: { toolCallId?: string; content: any; isError?: boolean }) {
    // Handle CONNECTOR_REAUTH_REQUIRED tag inside the result.
    const rawContent = typeof result.content === "string" ? result.content : JSON.stringify(result.content ?? "");
    const reauthMatch = rawContent.match(/CONNECTOR_REAUTH_REQUIRED:([a-z0-9-]+)/i);
    if (reauthMatch) {
      const server = reauthMatch[1];
      connectorBanner.state = "upstream-auth";
      connectorBanner.server = server;
      connectorBanner.visible = true;
      (window as any).__refreshConnectors?.();
    }
    updateMessage(messageId, (msg) => {
      const parts = msg.parts.map((p) => {
        if (p.kind !== "tool") return p;
        const t = p.tool;
        if (result.toolCallId ? t.id === result.toolCallId : t.state === "pending") {
          const isError = !!result.isError;
          return {
            kind: "tool" as const,
            tool: {
              ...t,
              state: isError ? ("error" as const) : ("done" as const),
              result: result.content,
              isError,
              elapsedText: formatElapsed(Date.now() - t.startedAt),
            },
          };
        }
        return p;
      });
      // If we only wanted the first matching pending (no toolCallId case)
      // — currently the map updates ALL pending tools; cap to the first.
      // Track flip-once via flag.
      if (!result.toolCallId) {
        let flipped = false;
        const single = msg.parts.map((p) => {
          if (p.kind !== "tool" || flipped) return p;
          if (p.tool.state !== "pending") return p;
          flipped = true;
          const isError = !!result.isError;
          return {
            kind: "tool" as const,
            tool: {
              ...p.tool,
              state: isError ? ("error" as const) : ("done" as const),
              result: result.content,
              isError,
              elapsedText: formatElapsed(Date.now() - p.tool.startedAt),
            },
          };
        });
        return { ...msg, parts: single };
      }
      return { ...msg, parts };
    });
    noteAgentActivity();
  }
  function finalizeStreaming() {
    messages = messages.map((m) => {
      if (!m.streaming || m.role !== "assistant") return m.streaming ? { ...m, streaming: false } : m;
      // Re-render text parts through markdown, AND finalize any tool part that
      // is still "pending": once a turn ends, an unresolved tool can't still be
      // running (its result frame never arrived — host timeout, disconnect, or
      // a dropped turn). Mark it errored so the card stops showing RUNNING
      // forever instead of hanging at a frozen elapsed time.
      const parts = m.parts.map((p) => {
        if (p.kind === "text" && p.text) return { kind: "text" as const, text: p.text, rendered: renderMarkdown(p.text) };
        if (p.kind === "tool" && p.tool.state === "pending") {
          return { kind: "tool" as const, tool: { ...p.tool, state: "error" as const, isError: true, result: p.tool.result ?? "No result — the turn ended before this tool returned (timed out, disconnected, or was cancelled).", elapsedText: formatElapsed(Date.now() - p.tool.startedAt) } };
        }
        return p;
      });
      return { ...m, streaming: false, parts };
    });
  }

  // ── Bootstrap & WebSocket ──────────────────────────────────────────
  let ws: WebSocket | null = null;
  let activeRequestId: string | null = null;
  let thinkMessages: any[] = [];
  let streamingMsgId: string | null = null;
  // True when activeRequestId came from localStorage on reconnect/page load,
  // not from a user submit in this mounted tab. Treat it as provisional: it
  // should help recover a live stream, but must not block rendering stored
  // history forever when the saved request id is stale.
  let restoredActiveTurn = false;
  // True while rebuilding the visible assistant response from Think's stored
  // stream chunks after a reconnect or a foreground resume probe.
  let responseRecoveryPending = false;
  let lastSocketActivityAt = Date.now();
  let connectionWatchdogId: ReturnType<typeof setInterval> | null = null;
  const ACTIVE_TURN_KEY_PREFIX = "my-ax-active-turn:";

  function activeTurnKey() {
    return ACTIVE_TURN_KEY_PREFIX + (localStorage.getItem(SESSION_KEY) || "unknown");
  }
  function rememberActiveTurn(id: string, clientMsgId: string) {
    localStorage.setItem(activeTurnKey(), JSON.stringify({ id, clientMsgId, at: Date.now() }));
  }
  function forgetActiveTurn() { localStorage.removeItem(activeTurnKey()); }
  function restoreActiveTurn() {
    try {
      const saved = JSON.parse(localStorage.getItem(activeTurnKey()) || "null");
      if (saved?.id && Date.now() - Number(saved.at || 0) < 86400000) {
        activeRequestId = saved.id;
        restoredActiveTurn = true;
        dispatchTurn({ type: "restore", requestId: saved.id });
        applyStatus("thinking");
      } else if (saved) forgetActiveTurn();
    } catch { forgetActiveTurn(); }
  }

  // Connector banner state (in-chat red banner).
  const connectorBanner = $state({
    visible: false,
    state: "needs-auth" as "needs-auth" | "upstream-auth",
    server: null as string | null,
  });

  async function refreshPendingDecision(sessionId: string | null) {
    pendingDecision = null;
    if (!sessionId) return;
    try {
      const response = await fetch(`/api/decisions/pending?sessionId=${encodeURIComponent(sessionId)}`, { credentials: "include" });
      if (!response.ok) return;
      pendingDecision = (await response.json())?.result?.decision ?? null;
    } catch {}
  }

  const sessionGeneration = new SessionGenerationGuard();
  const sessionWorkIsCurrent = (expected: SessionGeneration) =>
    sessionGeneration.isCurrent(expected, localStorage.getItem(SESSION_KEY));

  async function bootstrap() {
    setConn("offline");
    showOAuthCallbackToast();
    const sessionId = await sessionForBootstrap();
    sessionGeneration.activate(sessionId);
    if (!sessionId) {
      setConn("live");
      return;
    }
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = makeReconnectingSocket(`${proto}//${location.host}/agents/my-agent/${sessionId}`);
    void refreshPendingDecision(sessionId);
  }

  // In-place conversation switch — no full page reload. Closes the current
  // socket, swaps the active session, and reconnects so the server replays
  // history via cf_agent_chat_messages. Avoids the re-download/re-parse jank.
  function switchToSession(id: string) {
    if (!id || id === localStorage.getItem(SESSION_KEY)) return;
    sessionGeneration.activate(id);
    try { ws?.close(); } catch {}
    ws = null;
    activeRequestId = null;
    restoredActiveTurn = false;
    streamingMsgId = null;
    responseRecoveryPending = false;
    dispatchTurn({ type: "session-switch" });
    messages = [];
    toastBus.pending = []; // don't carry a prior session's notices into this one
    applyStatus("idle");
    onboardingHidden = true;
    resumingExistingSession = true;
    sessionResumeVisible = true;
    localStorage.setItem(SESSION_KEY, id);
    setActiveSession(id);
    void refreshPendingDecision(id);
    void refreshActiveSessionTitle(id);
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    setConn("reconnecting");
    ws = makeReconnectingSocket(`${proto}//${location.host}/agents/my-agent/${id}`);
    queueMicrotask(() => { void hydrateHistoryTimestamps(); });
  }

  const START_FRESH_ONCE_KEY = "my-ax-start-fresh-once";

  async function refreshActiveSessionTitle(id: string) {
    try {
      const body = await fetch("/api/sessions?limit=100", { credentials: "include" }).then((response) => response.json());
      const row = body?.result?.sessions?.find((session: any) => session.id === id);
      if (row?.name && localStorage.getItem(SESSION_KEY) === id) setActiveSession(id, row.name);
    } catch {}
  }

  async function latestServerSessionId(): Promise<string | null> {
    const response = await fetch("/api/sessions?limit=1", { credentials: "include" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    const id = body?.result?.sessions?.[0]?.id;
    return typeof id === "string" && id ? id : null;
  }

  async function sessionForBootstrap(): Promise<string | null> {
    const requested = new URL(location.href).searchParams.get("session");
    const shouldResume = sessionStorage.getItem(RESUME_SESSION_ONCE_KEY) === "1";
    const isFirstSendSession = sessionStorage.getItem(FIRST_SEND_SESSION_ONCE_KEY) === "1";
    const startFresh = sessionStorage.getItem(START_FRESH_ONCE_KEY) === "1";
    sessionStorage.removeItem(RESUME_SESSION_ONCE_KEY);
    sessionStorage.removeItem(FIRST_SEND_SESSION_ONCE_KEY);
    sessionStorage.removeItem(START_FRESH_ONCE_KEY);
    const cached = localStorage.getItem(SESSION_KEY);

    if (startFresh) {
      localStorage.removeItem(SESSION_KEY);
      setActiveSession(null);
      bootstrapPending = false;
      return null;
    }

    let resumeId = requested || (shouldResume ? cached : null);
    if (!resumeId) {
      try {
        resumeId = await latestServerSessionId();
      } catch (error) {
        pushError(`Could not load your latest conversation: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (resumeId) {
      localStorage.setItem(SESSION_KEY, resumeId);
      setActiveSession(resumeId);
      void refreshActiveSessionTitle(resumeId);
      if (requested) history.replaceState(null, "", location.pathname + location.hash);
      onboardingHidden = true;
      resumingExistingSession = !isFirstSendSession;
      sessionResumeVisible = !isFirstSendSession;
      bootstrapPending = false;
      return resumeId;
    }
    localStorage.removeItem(SESSION_KEY);
    setActiveSession(null);
    bootstrapPending = false;
    return null;
  }

  async function createSession(): Promise<string> {
    const r = await fetch("/api/sessions", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!r.ok) throw new Error("session create HTTP " + r.status);
    const session = (await r.json()).result;
    localStorage.setItem(SESSION_KEY, session.sessionId);
    setActiveSession(session.sessionId, session.name);
    return session.sessionId;
  }

  function makeReconnectingSocket(url: string) {
    return createReconnectingSocket(url, {
      onOpen() {
        lastSocketActivityAt = Date.now();
        onOpen();
      },
      onClose(e) {
        onClose(e);
      },
      onError() {
        setConn("reconnecting");
      },
      onMessage(data) {
        lastSocketActivityAt = Date.now();
        onMessage(data);
      },
    });
  }

  function onOpen() {
    setConn("live");
    restoreActiveTurn();
    sendVisibility();
    // If a connection was suspended/replaced during a live turn, Think can
    // replay both active and already-completed streams by request id.
    requestActiveResponseRecovery();
    const pendingFirst = sessionStorage.getItem("my-ax-pending-first-message");
    const pendingFirstAttachments = sessionStorage.getItem("my-ax-pending-first-attachments");
    if (pendingFirst || pendingFirstAttachments) {
      sessionStorage.removeItem("my-ax-pending-first-message");
      sessionStorage.removeItem("my-ax-pending-first-attachments");
      composerText = pendingFirst || "Describe the attached image.";
      if (pendingFirstAttachments) {
        try {
          pendingAttachments = JSON.parse(pendingFirstAttachments);
        } catch {}
      }
      // Hydration + WS-open race on a brand-new session. Let the reactive
      // composer effect below submit once BOTH the form binding and live WS
      // state are settled; timer retries here were inherently racy.
      pendingFirstReady = true;
    }
  }
  function onClose(_e: CloseEvent) {
    dispatchTurn({ type: "connection-close" });
    // A non-manual close always schedules a retry. Manual closes are retired
    // inside createReconnectingSocket and never reach this callback.
    setConn("reconnecting");
    // Do not discard an active request here. Think persists stream chunks and
    // can replay a response after reconnect, including a response that
    // completed while this tab was suspended in the background.
    responseRecoveryPending = false;
  }

  function requestActiveResponseRecovery(requestId = activeRequestId) {
    if (!requestId || !ws || (ws as any).readyState !== WebSocket.OPEN) return;
    if (activeRequestId && activeRequestId !== requestId) return;
    if (responseRecoveryPending) return;
    if (!activeRequestId) {
      activeRequestId = requestId;
      applyStatus("running");
    }
    responseRecoveryPending = true;
    window.setTimeout(() => {
      if (!responseRecoveryPending || activeRequestId !== requestId || !restoredActiveTurn) return;
      // No resume answer arrived. The saved request id is stale; show the
      // existing transcript instead of pinning the restored session under the
      // loading veil / running state.
      responseRecoveryPending = false;
      dispatchTurn({ type: "resume-timeout", requestId });
      activeRequestId = null;
      restoredActiveTurn = false;
      streamingMsgId = null;
      forgetActiveTurn();
      applyStatus("idle");
      if (!messages.length && thinkMessages.length) renderThinkHistory(thinkMessages);
      else void revealResumedHistoryAtBottom();
    }, 8000);
    // Resume replay begins at chunk zero. Remove the transient rendering of
    // this one response before replay so already-seen prefixes are not doubled.
    if (streamingMsgId) {
      messages = messages.filter((message) => message.id !== streamingMsgId);
      streamingMsgId = null;
    }
    dispatchTurn({ type: "resume-requested", requestId });
    (ws as any).send(JSON.stringify({ type: "cf_agent_stream_resume_ack", id: requestId }));
  }

  function onMessage(raw: string) {
    lastSocketActivityAt = Date.now();
    let m: any;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (m.type === "my_ax_pong") {
      return;
    } else if (m.type === "cf_agent_stream_resuming") {
      // Server advertised a resumable in-flight stream on connection. An
      // already-open tab normally owns activeRequestId; a newly mounted view
      // may learn it here while restoring a conversation.
      requestActiveResponseRecovery(typeof m.id === "string" ? m.id : null);
    } else if (m.type === "cf_agent_stream_resume_none") {
      responseRecoveryPending = false;
      if (activeRequestId) {
        dispatchTurn({ type: "resume-none", requestId: activeRequestId });
        finalizeStreaming();
        messages = messages.map((message) => ({
          ...message,
          parts: message.parts.map((part) =>
            part.kind === "tool" && part.tool.state === "pending"
              ? {
                  kind: "tool" as const,
                  tool: {
                    ...part.tool,
                    state: "error" as const,
                    result: "Connection lost while this tool was running.",
                    isError: true,
                  },
                }
              : part,
          ),
        }));
        activeRequestId = null;
        streamingMsgId = null;
        restoredActiveTurn = false;
        forgetActiveTurn();
        applyStatus("idle");
        pushError("Response interrupted and could not be resumed after reconnect. Please retry.");
      }
    } else if (m.type === "my_ax_connector_reauth") {
      connectorBanner.state = "upstream-auth";
      connectorBanner.server = m.server;
      connectorBanner.visible = true;
      (window as any).__refreshConnectors?.();
    } else if (m.type === "cf_agent_chat_messages") {
      dispatchTurn({ type: "history-loaded" });
      if (activeRequestId && !restoredActiveTurn) {
        thinkMessages = m.messages || thinkMessages;
      } else {
        // A restored activeRequestId is only a recovery hint. Existing-session
        // resume must still render its durable history immediately; otherwise a
        // stale local active-turn marker can leave the conversation stuck behind
        // the spinner even though the socket is connected.
        renderThinkHistory(m.messages || []);
      }
    } else if (m.type === "cf_agent_use_chat_response" && m.id !== activeRequestId && !activeRequestId) {
      // A turn we didn't start from the composer — i.e. a VOICE turn running
      // in this same DO. Adopt its request id so the assistant text streams
      // into the chat log live (and is finalized on done), instead of being
      // dropped. This is what makes spoken replies visible.
      if (m.error) {
        dispatchTurn({ type: "frame", frame: { requestId: typeof m.id === "string" ? m.id : null, error: m.body || "Voice turn failed" } });
        pushError(m.body || "Voice turn failed");
        applyStatus("idle");
      } else if (m.done) {
        dispatchTurn({ type: "frame", frame: { requestId: typeof m.id === "string" ? m.id : null, done: true } });
        finalizeStreaming();
        streamingMsgId = null;
        applyStatus("idle");
        (window as any).__refreshConnectors?.();
      } else if (m.body) {
        applyStatus("running");
        try { handleThinkChunk(JSON.parse(m.body)); } catch {}
      } else {
        applyStatus("running");
      }
    } else if (m.type === "cf_agent_use_chat_response" && m.id !== activeRequestId) {
      // A reconnect can leave the browser holding a stale request id. Never
      // discard a terminal error merely because its id differs: that was the
      // primary "agent died with no error" failure mode.
      if (m.error) {
        dispatchTurn({ type: "frame", frame: { requestId: typeof m.id === "string" ? m.id : null, error: m.body || "Agent request failed" } });
        finalizeStreaming();
        pushError(m.body || "Agent request failed");
        responseRecoveryPending = false;
        activeRequestId = null;
        streamingMsgId = null;
        restoredActiveTurn = false;
        forgetActiveTurn();
        applyStatus("idle");
      } else if (!m.done) applyStatus("running");
      else {
        applyStatus("idle");
        (window as any).__refreshConnectors?.();
      }
    } else if (m.type === "cf_agent_use_chat_response" && m.id === activeRequestId) {
      if (m.error) {
        dispatchTurn({ type: "frame", frame: { requestId: typeof m.id === "string" ? m.id : null, error: m.body || "Agent request failed" } });
        finalizeStreaming();
        pushError(m.body || "Agent request failed");
        responseRecoveryPending = false;
        activeRequestId = null;
        streamingMsgId = null;
        restoredActiveTurn = false;
        forgetActiveTurn();
        applyStatus("idle");
        window.dispatchEvent(new Event("my-ax:sessions-refresh"));
      } else if (m.done) {
        dispatchTurn({ type: "frame", frame: { requestId: typeof m.id === "string" ? m.id : null, done: true } });
        finalizeStreaming();
        // Don't silently leave an empty "Agent" card. Think can complete a
        // tool-only / interrupted turn without text; surface that as an
        // explicit recoverable error instead of looking like the agent died.
        // Inspect the latest assistant message, not just the captured
        // streamingMsgId (text and tool/artifact output can land in different
        // messages, which falsely tripped the "no visible response" error).
        const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
        const hasVisibleOutput = !!lastAssistant && (
          lastAssistant.content.trim().length > 0 ||
          lastAssistant.parts.some((part) => (part.kind === "text" && part.text.trim().length > 0) || part.kind === "tool")
        );
        if (!hasVisibleOutput) pushError("Agent completed without a visible response. Please retry.");
        responseRecoveryPending = false;
        activeRequestId = null;
        streamingMsgId = null;
        restoredActiveTurn = false;
        forgetActiveTurn();
        applyStatus("idle");
        (window as any).__refreshConnectors?.();
      } else if (m.body) {
        try {
          handleThinkChunk(JSON.parse(m.body));
        } catch {}
      } else if (m.replayComplete) {
        // Stored prefix has been rebuilt; any subsequent chunks are live.
        dispatchTurn({ type: "frame", frame: { requestId: typeof m.id === "string" ? m.id : null, replayComplete: true } });
        responseRecoveryPending = false;
        applyStatus("running");
      }
    }
  }

  const loadSessionEntries = (expected: SessionGeneration, maxPages: number) => loadCurrentSessionEntries<any>({
    expected, isCurrent: sessionWorkIsCurrent, maxPages,
    fetchPage: (after) => fetch(`/api/sessions/${encodeURIComponent(expected.sessionId)}/entries?after=${encodeURIComponent(after)}&limit=200`, { credentials: "include" }),
  });

  async function hydrateHistoryTimestamps() {
    const expected = sessionGeneration.capture();
    if (!expected) return;
    const result = await loadSessionEntries(expected, 10);
    if (result.outcome === "stale") return;
    const timestamps = new Map<string, number>();
    for (const entry of result.entries) {
      const uiMessageId = entry?.meta?.uiMessageId;
      const timestamp = Date.parse(entry?.createdAt ?? "");
      if (typeof uiMessageId === "string" && Number.isFinite(timestamp)) timestamps.set(uiMessageId, timestamp);
    }
    if (!sessionWorkIsCurrent(expected)) return;
    messages = messages.map((message) => ({ ...message, timestamp: timestamps.get(message.id) ?? message.timestamp }));
  }

  async function restoreD1History(expected = sessionGeneration.capture()): Promise<RestoreOutcome> {
    if (!expected || !sessionWorkIsCurrent(expected)) return "stale";
    const result = await loadSessionEntries(expected, 20);
    if (result.outcome === "stale") return "stale";
    const restored: Message[] = [];
    for (const entry of result.entries) {
      const role = entry.role === "tool" ? "system" : entry.role;
      const label = entry.role === "tool" ? `[${entry.tool || "tool"}] ` : "";
      restored.push({ id: entry.meta?.uiMessageId || `d1-${entry.id}`, role, content: `${label}${entry.content || ""}`, parts: [{ kind: "text", text: `${label}${entry.content || ""}`, rendered: role === "assistant" ? renderMarkdown(entry.content || "") : undefined }], timestamp: Date.parse(entry.createdAt) || Date.now(), streaming: false });
    }
    if (!sessionWorkIsCurrent(expected)) return "stale";
    if (!restored.length) return "empty";
    messages = restored;
    onboardingHidden = true;
    pushSystem("Conversation restored from the durable transcript.");
    return "restored";
  }

  // When Think compacts a long session it replays fewer messages than the
  // human actually wrote. The durable D1 transcript is the human-facing truth,
  // so on resume, if D1 holds more user turns than Think replayed, show the
  // full transcript for display while Think keeps its compacted model context.
  async function reconcileCompactedHistory(thinkUserTurns: number) {
    const expected = sessionGeneration.capture();
    if (!expected) return;
    try {
      const result = await loadSessionEntries(expected, 20);
      if (result.outcome === "stale") return;
      const d1UserTurns = result.entries.filter((entry: any) => entry.role === "user").length;
      // Only override the view if D1 genuinely has more conversation than Think
      // replayed, and we're still idle on this same session.
      if (d1UserTurns > thinkUserTurns && !activeRequestId && sessionWorkIsCurrent(expected)) {
        await restoreD1History(expected);
      }
    } catch {}
  }

  function renderThinkHistory(historyMessages: any[]) {
    if (activeRequestId) return;
    const wasResuming = resumingExistingSession;
    thinkMessages = historyMessages || [];
    const existingTimestamps = new Map(messages.map((message) => [message.id, message.timestamp]));
    messages = [];
    if (thinkMessages.length > 0) {
      onboardingHidden = true;
      if (wasResuming) {
        const thinkUserTurns = thinkMessages.filter((message: any) => message.role === "user").length;
        void reconcileCompactedHistory(thinkUserTurns);
      }
    } else if (resumingExistingSession) {
      void restoreD1History().then((outcome) => {
        if (shouldReportEmptyRestore(outcome)) pushError("This conversation has no recoverable transcript. Start a new conversation or choose another session.");
      });
    }
    resumingExistingSession = false;
    const seenViewIds = new Map<string, number>();
    for (const message of thinkMessages) {
      const text = (message.parts || [])
        .filter((p: any) => p.type === "text")
        .map((p: any) => p.text || "")
        .join("");
      const reasoning = (message.parts || [])
        .filter((p: any) => p.type === "reasoning")
        .map((p: any) => p.text || "")
        .join("");
      const attachments = (message.parts || [])
        .filter((p: any) => p.type === "data-attachment")
        .map((p: any) => p.data)
        .filter(Boolean);
      // Walk parts in source order, preserving the chronological
      // interleaving of text and tool calls.
      const orderedParts: Part[] = [];
      for (const part of message.parts || []) {
        if (part.type === "text" && part.text) {
          orderedParts.push({ kind: "text", text: part.text, rendered: message.role === "assistant" ? renderMarkdown(part.text) : undefined });
        } else if (part.type?.startsWith("tool-") && part.toolCallId) {
          const isErr = part.state === "output-error" || part.state === "output-denied";
          const done = part.state === "output-available";
          // CRITICAL: a tool part loaded from HISTORY can never be live-running.
          // If it has no output and isn't an explicit error, it's an
          // incomplete/abandoned call from a past turn (interrupted, timed out,
          // never resolved). Render it as a terminal "error" — NOT "pending",
          // which would start the elapsed ticker and show RUNNING forever.
          const incomplete = !done && !isErr;
          orderedParts.push({
            kind: "tool",
            tool: {
              id: part.toolCallId,
              name: part.toolName || part.type.slice(5),
              arguments: part.input || {},
              state: done ? "done" : "error",
              startedAt: Date.now(),
              elapsedText: "",
              result: part.output ?? part.errorText ?? (incomplete ? "Incomplete tool call from an earlier turn (no result was recorded — it was interrupted, timed out, or never returned)." : ""),
              isError: isErr || incomplete,
            },
          });
        }
      }
      const rawId = typeof message.id === "string" && message.id ? message.id : `history-${messages.length}`;
      const occurrence = seenViewIds.get(rawId) ?? 0;
      seenViewIds.set(rawId, occurrence + 1);
      const m: MessageView = {
        // Think history should provide stable unique ids, but a duplicated id
        // must not crash the entire Svelte chat mount during recovery.
        id: occurrence === 0 ? rawId : `${rawId}-replay-${occurrence}`,
        role: message.role,
        content: text,
        parts: orderedParts,
        reasoning: reasoning || undefined,
        attachments,
        // Think UIMessage.createdAt is a Date or ISO string, not a number;
        // coerce so assistant messages get a timestamp (bug: agent rows had none).
        timestamp: toMillis(message.createdAt) ?? existingTimestamps.get(rawId),
        streaming: false,
        pending: false,
      };
      messages = [...messages, m];
    }
    void hydrateHistoryTimestamps();
    void revealResumedHistoryAtBottom();
  }

  function handleThinkChunk(chunk: any) {
    if (typeof chunk?.type === "string") {
      dispatchTurn({ type: "frame", frame: { requestId: activeRequestId, chunkType: chunk.type } });
    }
    if (
      !streamingMsgId &&
      ["text-start", "text-delta", "reasoning-start", "reasoning-delta", "tool-input-start", "tool-input-available"].includes(chunk.type)
    ) {
      streamingMsgId = `a-${activeRequestId || Date.now()}`;
    }
    const id = streamingMsgId;
    if (!id) return;
    if (chunk.type === "text-delta") {
      appendDelta(id, chunk.delta || "");
      applyStatus("running");
    } else if (chunk.type === "reasoning-delta") {
      appendReasoningDelta(id, chunk.delta || "");
    } else if (chunk.type === "tool-input-available") {
      appendToolCall(id, { id: chunk.toolCallId, name: chunk.toolName, arguments: chunk.input || {} });
    } else if (chunk.type === "tool-output-available" || chunk.type === "tool-output-error") {
      attachToolResult(id, {
        toolCallId: chunk.toolCallId,
        content: chunk.output ?? chunk.errorText ?? "",
        isError: chunk.type === "tool-output-error",
      });
      // Tool output can create or resolve owner attention (notably ask_user).
      // Reconcile from the durable decision index immediately instead of
      // waiting for a reload/session switch or trusting tool payload shape.
      void refreshPendingDecision(localStorage.getItem(SESSION_KEY));
    } else if (chunk.type === "finish") {
      finalizeStreaming();
    }
  }

  // ── Composer ──────────────────────────────────────────────────────
  let formEl = $state<HTMLFormElement | undefined>(undefined);
  let pendingFirstReady = $state(false);

  function autoGrow() {
    if (!inputEl) return;
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + "px";
  }
  function onInputInput() {
    autoGrow();
  }
  function onInputKeydown(e: KeyboardEvent) {
    if (e.key !== "Enter") return;
    if (e.shiftKey) return;
    if (e.isComposing || (e as any).keyCode === 229) return;
    e.preventDefault();
    if (wsState.status !== "idle" && wsState.status !== "done") return;
    if (wsState.conn !== "live") return;
    formEl?.requestSubmit();
  }
  async function onInputPaste(e: ClipboardEvent) {
    for (const item of e.clipboardData?.items || []) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) await addImageFile(file);
      }
    }
  }
  async function addImageFile(file: File) {
    const formData = new FormData();
    formData.set("file", file);
    formData.set("sessionId", localStorage.getItem(SESSION_KEY) || "draft");
    const response = await fetch("/api/uploads", {
      method: "POST",
      credentials: "include",
      body: formData,
    });
    const body = await response.json();
    if (!response.ok) {
      pushError(body?.error?.message || "Image upload failed");
      return;
    }
    pendingAttachments = [...pendingAttachments, body.result];
  }
  function removeAttachment(idx: number) {
    pendingAttachments = pendingAttachments.filter((_, i) => i !== idx);
  }
  function openImageFile() {
    (document.getElementById("svelte-image-file") as HTMLInputElement)?.click();
  }
  async function onImageInputChange(e: Event) {
    const files = (e.target as HTMLInputElement).files;
    if (!files) return;
    for (const f of Array.from(files)) await addImageFile(f);
    (e.target as HTMLInputElement).value = "";
  }

  function makeClientMsgId() {
    return "u-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);
  }

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (composerLocked) return;
    if (wsState.conn !== "live" && ws) return;
    const text = composerText.trim();
    if (!text && pendingAttachments.length === 0) return;

    if (!ws) {
      // First message: spin a session, stash payload, reload.
      try {
        await createSession();
      } catch (err: any) {
        pushError("Could not create session: " + err.message);
        return;
      }
      sessionStorage.setItem(RESUME_SESSION_ONCE_KEY, "1");
      sessionStorage.setItem(FIRST_SEND_SESSION_ONCE_KEY, "1");
      sessionStorage.setItem("my-ax-pending-first-message", text || "Describe the attached image.");
      sessionStorage.setItem("my-ax-pending-first-attachments", JSON.stringify(pendingAttachments));
      location.reload();
      return;
    }

    toastBus.pending = []; // clear transient notices when a new turn starts
    const clientMsgId = makeClientMsgId();
    const outgoingAttachments = pendingAttachments;
    pendingAttachments = [];
    onboardingHidden = true;
    messages = [
      ...messages,
      {
        id: clientMsgId,
        clientMsgId,
        role: "user",
        content: text,
        attachments: outgoingAttachments,
        timestamp: Date.now(),
        streaming: false,
        pending: true,
        parts: [],
      },
    ];
    queueScrollToBottom();

    sendThinkMessage(text, outgoingAttachments, clientMsgId);

    composerText = "";
    applyStatus("thinking");
    // bind:value updates the DOM after state is flushed. Measure only then;
    // measuring immediately sees the sent multi-line value and leaves a tall
    // empty composer occupying the phone viewport.
    await tick();
    autoGrow();
  }

  // One-shot first-send replay after session creation reload. This effect is
  // the convergence point for Svelte hydration + <form bind:this> + WS-open.
  $effect(() => {
    if (!pendingFirstReady || !formEl || wsState.conn !== "live") return;
    pendingFirstReady = false;
    queueMicrotask(() => formEl?.requestSubmit());
  });

  function sendThinkMessage(text: string, attachments: Attachment[], clientMsgId: string) {
    const user = {
      id: clientMsgId,
      role: "user",
      parts: [
        { type: "text", text },
        ...attachments.flatMap((a) => [
          { type: "data-attachment", data: a },
          { type: "file", url: `/api/uploads/${encodeURIComponent(a.key)}`, mediaType: a.mime, filename: a.name },
        ]),
      ],
    };
    thinkMessages = [...thinkMessages, user];
    activeRequestId = crypto.randomUUID();
    restoredActiveTurn = false;
    dispatchTurn({ type: "submit", requestId: activeRequestId, clientMessageId: clientMsgId });
    rememberActiveTurn(activeRequestId, clientMsgId);
    streamingMsgId = null;
    ws!.send(
      JSON.stringify({
        type: "cf_agent_use_chat_request",
        id: activeRequestId,
        init: {
          method: "POST",
          body: JSON.stringify({
            messages: thinkMessages,
            trigger: "submit-message",
            model: modelState.current,
            reasoningEffort: modelState.reasoning,
          }),
        },
      }),
    );
  }

  function onSendClick(e: MouseEvent) {
    const cancellable = wsState.status !== "idle" && wsState.status !== "done";
    if (!cancellable) return;
    e.preventDefault();
    e.stopPropagation();
    if (window.confirm("Stop the agent?")) cancelAgent();
  }
  function cancelAgent() {
    if (wsState.status === "idle" || wsState.status === "done") return;
    if (ws && (ws as any).readyState === WebSocket.OPEN) {
      if (activeRequestId)
        (ws as any).send(JSON.stringify({ type: "cf_agent_chat_request_cancel", id: activeRequestId }));
    }
    // Clean up the local view: finalize the stream so any still-pending tool
    // card stops showing RUNNING, and clear the active-stream pointers.
    finalizeStreaming();
    activeRequestId = null;
    restoredActiveTurn = false;
    streamingMsgId = null;
    responseRecoveryPending = false;
    dispatchTurn({ type: "reset" });
    forgetActiveTurn();
    applyStatus("idle");
  }

  // Global Esc → cancel agent, unless a modal or conversation sidebar is open.
  function onGlobalKeydown(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    const settingsOpen = document.querySelector<HTMLDialogElement>("dialog#settings-drawer")?.open ?? false;
    const sidebarOpen = document.documentElement.dataset.svelteSessionsOpen === "1";
    if (settingsOpen || sidebarOpen) return;
    cancelAgent();
  }

  // ── Onboarding cards ──────────────────────────────────────────────
  const prompts = [
    {
      title: "Inspect my workspace",
      hint: "Uses the persistent My AX Workspace.",
      prompt: "What's in /home/user? Pick anything interesting and tell me about it.",
    },
    {
      title: "Add an MCP server",
      hint: "Settings → Connectors → Add MCP server (BYO OAuth).",
      prompt: "How do I add a new MCP server here? Walk me through Settings → Connectors.",
    },
    {
      title: "Quick research question",
      hint: "Plain reasoning, no tool calls.",
      prompt: "Explain the difference between Cloudflare Sandbox SDK and Containers in 5 bullets.",
    },
    {
      title: "Script + run end-to-end",
      hint: "Exercises workspace.write + workspace.exec through Work Code Mode.",
      prompt: "Write a small Python script to /home/user/hello.py that prints the date, then run it.",
    },
  ];
  function pickPrompt(p: string) {
    composerText = p;
    autoGrow();
    inputEl?.focus();
  }

  // ── OAuth callback toast ──────────────────────────────────────────
  function showOAuthCallbackToast() {
    const params = new URLSearchParams(location.search);
    const connector = params.get("connector");
    const result = params.get("result");
    if (!connector || !result) return;
    history.replaceState(null, "", location.pathname + location.hash);
    if (result === "ok") {
      pushSystem(`✓ Authorized ${connector}. You can now use its tools.`);
      connectorBanner.visible = false;
    } else {
      pushError(`Authorization failed for ${connector}. Tap "Authorize" to try again.`);
      connectorBanner.visible = true;
    }
  }

  // ── Live elapsed-time ticker for pending tool calls ─────────────────
  let elapsedTickerId: ReturnType<typeof setInterval> | null = null;
  function tickElapsed() {
    const now = Date.now();
    let anyPending = false;
    messages = messages.map((m) => {
      // Only tick the actively-streaming message. A pending tool on a
      // non-streaming message is stale (history/orphan) and must not spin a
      // forever-climbing RUNNING timer.
      if (!m.streaming) return m;
      const pending = m.parts.some((p) => p.kind === "tool" && p.tool.state === "pending");
      if (!pending) return m;
      anyPending = true;
      return {
        ...m,
        parts: m.parts.map((p) =>
          p.kind === "tool" && p.tool.state === "pending"
            ? { kind: "tool" as const, tool: { ...p.tool, elapsedText: formatElapsed(now - p.tool.startedAt) } }
            : p,
        ),
      };
    });
    if (!anyPending && elapsedTickerId) {
      clearInterval(elapsedTickerId);
      elapsedTickerId = null;
    }
  }
  $effect(() => {
    const hasPending = messages.some((m) =>
      m.parts.some((p) => p.kind === "tool" && p.tool.state === "pending"),
    );
    if (hasPending && !elapsedTickerId) {
      elapsedTickerId = setInterval(tickElapsed, 1000);
    } else if (!hasPending && elapsedTickerId) {
      clearInterval(elapsedTickerId);
      elapsedTickerId = null;
    }
  });

  // ── Lifecycle ─────────────────────────────────────────────────────
  onMount(() => {
    ensureMarkedHljs().then(async () => {
      // Re-render completed text once lazy syntax highlighting is ready so
      // fenced code receives the same finalized styling as restored history.
      messages = messages.map((m) => {
        if (m.role !== "assistant" || m.streaming) return m;
        const parts = m.parts.map((p) =>
          p.kind === "text" && p.text
            ? { kind: "text" as const, text: p.text, rendered: renderMarkdown(p.text) }
            : p,
        );
        return { ...m, parts };
      });
    });
    // Do not auto-start the microphone on reload; a fresh user gesture is
    // required by browser permission and audio playback policies.
    localStorage.setItem("my-ax-voice-mode", "0");
    bootstrap();
    connectionWatchdogId = setInterval(() => {
      if (!ws || document.visibilityState !== "visible") return;
      const age = Date.now() - lastSocketActivityAt;
      if ((ws as any).readyState === WebSocket.OPEN && age > 30_000) {
        (ws as any).forceReconnect?.();
      } else if ((ws as any).readyState === WebSocket.OPEN && age > 10_000) {
        (ws as any).send(JSON.stringify({ type: "my_ax_ping", at: Date.now() }));
      }
      if (responseRecoveryPending && age > 15_000) responseRecoveryPending = false;
    }, 5_000);

    window.addEventListener("online", onVisibilityChange);
    document.addEventListener("keydown", onGlobalKeydown);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const onSwitch = (e: Event) => { const id = (e as CustomEvent<{ id?: string }>).detail?.id; if (id) { window.dispatchEvent(new Event("my-ax:switch-session-ack")); switchToSession(id); } };
    const followDeepLink = (target: MyAxDeepLink) => {
      if (target.sessionId) {
        history.replaceState(null, "", location.pathname + location.hash);
        switchToSession(target.sessionId);
        return;
      }
      if (target.action === "attention") { window.dispatchEvent(new Event("my-ax:attention-open")); return; }
      if (target.action === "settings") { window.dispatchEvent(new Event("my-ax:settings-open")); return; }
      location.assign(target.href);
    };
    const onNavigate = (event: Event) => {
      const detail = (event as CustomEvent<MyAxDeepLink>).detail;
      const target = detail?.href ? parseMyAxDeepLink(detail.href, location.href) : null;
      if (target) followDeepLink(target);
    };
    const onServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === "my-ax:attention") {
        void refreshPendingDecision(localStorage.getItem(SESSION_KEY));
        return;
      }
      if (event.data?.type !== "my-ax:navigate" || typeof event.data.href !== "string") return;
      const target = parseMyAxDeepLink(event.data.href, location.href);
      if (target) followDeepLink(target);
    };
    window.addEventListener("my-ax:switch-session", onSwitch as EventListener);
    window.addEventListener("my-ax:navigate", onNavigate as EventListener);
    navigator.serviceWorker?.addEventListener("message", onServiceWorkerMessage);
    return () => {
      document.removeEventListener("keydown", onGlobalKeydown);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("my-ax:switch-session", onSwitch as EventListener);
      window.removeEventListener("my-ax:navigate", onNavigate as EventListener);
      navigator.serviceWorker?.removeEventListener("message", onServiceWorkerMessage);
      window.removeEventListener("online", onVisibilityChange);
      if (connectionWatchdogId) clearInterval(connectionWatchdogId);
      void wakeLockSentinel?.release?.();
      wakeLockSentinel = null;
      void stopVoiceMode();
      if (elapsedTickerId) clearInterval(elapsedTickerId);
    };
  });

  // Attach copy buttons after each markdown re-render.
  $effect(() => {
    void messages; // dependency
    if (!logEl) return;
    tick().then(() => {
      if (logEl) attachCopyButtons(logEl);
    });
  });
</script>

<div class="h-full flex flex-col">
  <!-- Connector banner -->
  {#if connectorBanner.visible}
    <div
      class="connector-banner"
      data-show="1"
      data-state={connectorBanner.state}
    >
      <span class="connector-banner__dot" aria-hidden="true"></span>
      <div class="connector-banner__body">
        <strong class="connector-banner__title">
          {`${connectorBanner.server || "A connector"} needs authorization`}
        </strong>
        <span class="connector-banner__hint">
          Open Settings → Connectors and re-authorize this server to continue.
        </span>
      </div>
      <a
        href="#"
        onclick={(e) => {
          e.preventDefault();
          window.dispatchEvent(new Event("my-ax:settings-open"));
        }}
        class="connector-banner__cta"
      >
        Settings
      </a>
    </div>
  {/if}

  {#if pendingDecision}
    <a href={pendingDecision.href} class="mx-3 sm:mx-4 mt-2 flex items-center justify-between gap-3 rounded-lg border border-brand/35 bg-brand/10 px-3 py-2 text-sm text-fg hover:bg-brand/15" aria-label="Reopen pending decision">
      <span class="min-w-0"><strong class="text-brand">Needs your input</strong><span class="ml-2 text-fg-mut">{pendingDecision.question}</span></span>
      <span class="flex-none text-brand font-semibold">Open decision →</span>
    </a>
  {/if}

  <div class="flex-1 min-h-0 flex">
    <!-- Chat column -->
    <div class="flex-1 min-w-0 flex flex-col h-full">
      <main
        bind:this={logEl}
        class="relative flex-1 min-w-0 overflow-x-hidden overflow-y-auto overscroll-x-none touch-pan-y px-3 sm:px-6 lg:px-8 py-4 sm:py-6 scroll-smooth"
        tabindex={-1}
        aria-live="polite"
        aria-label="Conversation"
        onscroll={syncScrollToBottom}
      >
        <!-- Onboarding -->
        {#if !bootstrapPending && !onboardingHidden && messages.length === 0}
          <div class="max-w-3xl mx-auto mt-6 sm:mt-12 px-1 sm:px-6 text-center">
            <h1 class="flex justify-center" aria-label="my · ax">
              <img src="/static/brand/wordmark.svg" alt="my · ax" class="block dark:hidden h-[38px] sm:h-[56px] w-auto" />
              <img src="/static/brand/wordmark-dark.svg" alt="my · ax" class="hidden dark:block h-[38px] sm:h-[56px] w-auto" />
            </h1>
            <div class="mt-6 sm:mt-8 grid sm:grid-cols-2 gap-2 text-left">
              {#each prompts as p (p.title)}
                <button type="button" class="prompt-card" onclick={() => pickPrompt(p.prompt)}>
                  <span class="prompt-card__title">{p.title}</span>
                  <span class="prompt-card__hint">{p.hint}</span>
                </button>
              {/each}
            </div>
          </div>
        {/if}

        {#if bootstrapPending || sessionResumeVisible}
          <div
            class="absolute inset-0 z-10 grid place-items-center bg-bg/80 backdrop-blur-[1px]"
            role="status"
            aria-label="Resuming conversation"
          >
            <span class="session-resume-spinner" aria-hidden="true"></span>
          </div>
        {/if}

        <!-- Messages -->
        {#each messages as m (m.id)}
          <article
            class={`msg msg-${m.role} min-w-0 overflow-x-hidden` + (m.role === "tool" ? " msg-tool-compact" : "")}
            data-id={m.id}
            data-pending={m.pending ? "1" : "0"}
            data-streaming={m.streaming ? "1" : "0"}
          >
            {#if m.role !== "tool"}
              <header class="msg-head">
                <span class="msg-head__role">
                  {m.role === "user" ? "You" : m.role === "assistant" ? "Agent" : m.role === "error" ? "Error" : "System"}
                </span>
                {#if m.timestamp}
                  {@const d = new Date(m.timestamp)}
                  <time class="msg-head__ts" datetime={d.toISOString()} title={d.toLocaleString()}>
                    {formatMsgTime(d)}
                  </time>
                {/if}
                {#if !m.pending && !m.streaming}
                  <button type="button" onclick={() => copyMessage(m)} class="ml-auto inline-flex h-5 w-5 items-center justify-center rounded text-fg-mut/60 hover:bg-surface-2 hover:text-fg" aria-label={copiedMessageId === m.id ? "Copied" : "Copy message as Markdown"} title={copiedMessageId === m.id ? "Copied" : "Copy as Markdown"}>
                    {#if copiedMessageId === m.id}
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
                    {:else}
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    {/if}
                  </button>
                  <button type="button" onclick={() => forkFromMessage(m)} disabled={forkingMessageId !== null} class="inline-flex h-5 w-5 items-center justify-center rounded text-fg-mut/60 hover:bg-surface-2 hover:text-fg disabled:cursor-wait disabled:opacity-70" aria-label={forkingMessageId === m.id ? "Forking conversation" : "Fork conversation from this message"} title={forkingMessageId === m.id ? "Forking…" : "Fork from here"} aria-busy={forkingMessageId === m.id}>
                    {#if forkingMessageId === m.id}
                      <svg class="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.2-8.56"/></svg>
                    {:else}
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="4" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="20" r="2"/><path d="M8 4h4a4 4 0 0 1 4 4v8"/><path d="M8 20h4a4 4 0 0 0 4-4V8"/></svg>
                    {/if}
                  </button>
                {/if}
              </header>
              {#if m.role === "assistant" && m.reasoning}
                <details class="msg-reasoning">
                  <summary>Thinking</summary>
                  <pre class="msg-reasoning__body">{m.reasoning}</pre>
                </details>
              {/if}
              <!-- Body: user messages render their content directly;
                   assistant messages walk the chronological parts array
                   so text and tool calls interleave in the order the
                   model produced them. -->
              {#if m.role === "user"}
                <div class="msg-body">
                  {#if m.attachments && m.attachments.length}
                    <div class="mb-2 flex flex-wrap gap-2">
                      {#each m.attachments as a}
                        <img
                          src={`/api/uploads/${encodeURIComponent(a.key)}`}
                          alt={a.name || "uploaded image"}
                          class="h-20 w-20 rounded-md border border-line object-cover"
                        />
                      {/each}
                    </div>
                  {/if}
                  {m.content}
                </div>
              {:else if m.role === "assistant"}
                {#if m.parts.length === 0 && !m.streaming}
                  <div class="msg-body" data-empty="1"></div>
                {:else}
                  {#each groupParts(m.parts) as block, blockIdx (blockIdx)}
                    {#if block.kind === "text"}
                      <div class="msg-body">
                        {#if block.rendered}
                          <div class="prose prose-invert prose-sm max-w-none min-w-0 break-words [overflow-wrap:anywhere] [&_pre]:max-w-full [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto">{@html block.rendered}</div>
                        {:else}
                          {block.text}
                        {/if}
                      </div>
                    {:else}
                      <!-- Consecutive tool calls share one container; each is a
                           row with internal separators (see .msg-tools--group). -->
                      <div class="msg-tools msg-tools--group" data-count={block.tools.length}>
                        {#each block.tools as tool (tool.id)}
                          {@const resolved = resolveToolResultWidget(tool.result, tool.name)}
                          <!--
                            Duplicate collapse: preserve every underlying receipt
                            container, but if this receipt resolves to a reusable-tool
                            candidate and a newer receipt for the same fingerprint
                            exists in this conversation, render it as an inert raw
                            receipt instead of emitting another candidate card.
                          -->
                          {@const isSuppressedCandidate = resolved.kind === "reusable-tool-candidate" && !visibleReusableCandidateIds.has(tool.id)}
                          {@const effectiveKind = isSuppressedCandidate ? "raw-text" : resolved.kind}
                          <details class="tool-call" data-tool-id={tool.id} data-state={tool.state} data-tool-widget={effectiveKind} data-suppressed-candidate={isSuppressedCandidate ? "1" : "0"} open={!isSuppressedCandidate && toolIsOpen(tool, effectiveKind)} ontoggle={(e) => setToolOpen(tool.id, (e.currentTarget as HTMLDetailsElement).open)}>
                            <summary class="tool-call__summary">
                              <span class="tool-call__pip" aria-hidden="true"></span>
                              <span class="tool-call__name">{tool.name}</span>
                              <span class="tool-call__args">{briefArgs(tool.arguments)}</span>
                              <span class="tool-call__elapsed" aria-label="elapsed">{tool.elapsedText}</span>
                              <span class="tool-call__status">
                                {tool.state === "pending" ? "…running" : tool.state === "error" ? "error" : "ok"}
                              </span>
                            </summary>
                            <pre class="tool-call__argsfull">{JSON.stringify(tool.arguments, null, 2)}</pre>
                            {#if tool.state === "pending"}
                              <pre class="tool-call__result">(awaiting result…)</pre>
                            {:else if isSuppressedCandidate}
                              <pre class="tool-call__result" data-tool-widget="raw-text">{typeof tool.result === "string" ? tool.result : JSON.stringify(tool.result, null, 2)}</pre>
                            {:else}
                              <ToolResultWidget result={tool.result} toolName={tool.name} />
                            {/if}
                          </details>
                        {/each}
                      </div>
                    {/if}
                  {/each}
                {/if}
              {:else}
                <div class="msg-body">{m.content}</div>
              {/if}
            {:else}
              <!-- Legacy tool-role message (history replay). Route it through
                   the same trusted registry as native assistant tool parts. -->
              {@const toolName = historicalToolName(m.content)}
              {@const resultWidget = resolveToolResultWidget(m.content, toolName)}
              <details class="tool-call tool-call--replay" data-state="done" data-tool-widget={resultWidget.kind} open={resultWidget.kind !== "raw-text"}>
                <summary class="tool-call__summary">
                  <span class="tool-call__pip" aria-hidden="true"></span>
                  <span class="tool-call__name">{toolName}</span>
                  <span class="tool-call__status" aria-label="from history" title="from history">↻</span>
                </summary>
                <ToolResultWidget result={m.content} {toolName} />
              </details>
            {/if}
          </article>
        {/each}

        <!-- Toasts (system / error) render AFTER messages so a transient
             notice sits in chronological position, never pinned above newer
             history. -->
        {#each toastBus.pending as t, toastIdx (`${t.id}-${toastIdx}`)}
          <article class={`msg msg-${t.kind}`}>
            <header class="msg-head">
              <span class="msg-head__role">{t.kind === "error" ? "Error" : "System"}</span>
            </header>
            <div class="msg-body">{t.text}</div>
          </article>
        {/each}

        <!-- Agent-thinking indicator -->
        {#if thinkingVisible}
          <div
            class="msg flex items-center gap-1.5 py-2"
            data-show="1"
            aria-live="polite"
            aria-label="Agent is thinking"
            role="status"
          >
            <span class="agent-thinking__dot" aria-hidden="true"></span>
            <span class="agent-thinking__dot" aria-hidden="true"></span>
            <span class="agent-thinking__dot" aria-hidden="true"></span>
          </div>
        {/if}
      </main>

      {#if scrollToBottomVisible}
        <button
          type="button"
          onclick={() => {
            if (logEl) logEl.scrollTo({ top: logEl.scrollHeight, behavior: "smooth" });
            syncScrollToBottom();
          }}
          class="fixed z-20 right-5 bottom-28 sm:bottom-24 rounded-full border border-line bg-bg/95 shadow-raise w-11 h-11 text-fg text-xl hover:border-brand/60"
          aria-label="Scroll to latest message"
          title="Scroll to bottom"
        >
          ↓
        </button>
      {/if}

      <!-- Composer -->
      <div class="flex-none border-t border-line bg-bg-alt">
        <form
          bind:this={formEl}
          onsubmit={onSubmit}
          class="safe-area-composer w-full max-w-5xl mx-auto flex gap-2 items-end px-3 sm:px-6 lg:px-8 py-2.5 sm:py-3"
          autocomplete="off"
        >
          <button
            type="button"
            onclick={toggleVoiceMode}
            class="voice-mode-button flex-none flex items-center justify-center rounded-lg w-11 h-11 border border-line bg-bg text-fg-mut hover:text-fg hover:border-brand/60 data-[active='1']:border-brand/60 data-[active='1']:text-brand data-[active='1']:bg-brand/10"
            data-active={voiceEnabled ? "1" : "0"}
            data-status={voiceStatus}
            style={voiceEnabled ? `--voice-level: ${Math.max(0.16, Math.min(1, voiceAudioLevel * 8))}` : undefined}
            aria-label={voiceEnabled ? "End voice conversation" : "Start voice conversation"}
            title={voiceEnabled ? `Voice mode · ${voiceStarting ? "starting" : voiceStatus}` : "Voice mode"}
          >
            {#if voiceEnabled}
              <span class="voice-mode-button__live" aria-hidden="true"></span>
            {:else}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 15a4 4 0 0 0 4-4V7a4 4 0 0 0-8 0v4a4 4 0 0 0 4 4Z" />
                <path d="M6 11a6 6 0 0 0 12 0" />
                <path d="M12 17v4" />
                <path d="M9 21h6" />
              </svg>
            {/if}
          </button>
          <div class="flex-1 min-w-0">
            {#if voiceEnabled && voiceInterim}
              <div class="voice-mode-interim" aria-live="polite">
                <span class="voice-mode-interim__state">{voiceStatus}</span>
                <span>{voiceInterim}</span>
              </div>
            {/if}
            {#if pendingAttachments.length > 0}
              <div class="mb-2 flex flex-wrap gap-2">
                {#each pendingAttachments as a, idx (`${a.key}-${idx}`)}
                  <span class="inline-flex items-center gap-2 rounded-md border border-line bg-bg px-2 py-1 text-xs text-fg">
                    {a.name || "image"}
                    <button
                      type="button"
                      onclick={() => removeAttachment(idx)}
                      aria-label="Remove image"
                    >×</button>
                  </span>
                {/each}
              </div>
            {/if}
            <textarea
              bind:this={inputEl}
              bind:value={composerText}
              oninput={onInputInput}
              onkeydown={onInputKeydown}
              onpaste={onInputPaste}
              rows={1}
              placeholder="…"
              class="w-full resize-none rounded-lg bg-bg border border-line text-fg placeholder:text-fg-mut/70 px-3.5 py-2.5 text-base sm:text-sm leading-snug focus:outline-none focus:border-brand/60 focus:ring-1 focus:ring-brand/40 min-h-[44px] max-h-40 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
              aria-label="Message"
            ></textarea>
          </div>
          <input
            id="svelte-image-file"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            class="hidden"
            onchange={onImageInputChange}
          />
          <button
            type="button"
            onclick={openImageFile}
            class="flex-none flex items-center justify-center rounded-lg w-11 h-11 border border-line bg-bg text-fg hover:border-brand/60"
            aria-label="Attach image"
            title="Attach image"
          >＋</button>
          <button
            type="submit"
            onclick={onSendClick}
            data-status={sendStatus}
            disabled={sendStatus === "offline"}
            class="flex-none flex items-center justify-center rounded-lg w-11 h-11 transition-all duration-150 border border-transparent
              data-[status=idle]:bg-brand/10 data-[status=idle]:text-brand data-[status=idle]:border-brand/25 data-[status=idle]:hover:bg-brand/20 data-[status=idle]:hover:border-brand/40 data-[status=idle]:active:bg-brand/25
              data-[status=thinking]:bg-brand data-[status=thinking]:text-white data-[status=thinking]:hover:bg-brand/90
              data-[status=running]:bg-brand data-[status=running]:text-white data-[status=running]:hover:bg-brand/90
              data-[status=offline]:bg-surface-1 data-[status=offline]:text-fg-mut/50 data-[status=offline]:cursor-not-allowed"
            aria-label={sendStatus === "thinking" || sendStatus === "running" ? "Stop the agent" : "Send message"}
            title={sendStatus === "offline" ? (wsState.conn === "reconnecting" ? "Reconnecting…" : "Offline") : sendStatus === "thinking" || sendStatus === "running" ? "Stop the agent" : "Send (⌘↵)"}
          >
            {#if sendStatus === "idle" || sendStatus === "offline"}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            {:else}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            {/if}
          </button>
        </form>
      </div>
    </div>

  </div>
</div>
