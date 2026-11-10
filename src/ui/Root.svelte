<script lang="ts">
  import { onMount, tick } from "svelte";
  import { PiTranscript, type PiChatMessage } from "./pi-transcript";
  import { rootDraftKey, storageDraftStore, widgetTurn, widgetTurnLabel, type DraftStore } from "./root-widget-state";

  type Child = { id: string; name: string; status: string };

  let rootId = $state<string | null>(null);
  let loadError = $state<string | null>(null);
  let connected = $state(false);
  let busy = $state(false);
  let messages = $state<PiChatMessage[]>([]);
  let children = $state<Child[]>([]);
  let draft = $state("");
  let open = $state(false);
  let maximized = $state(false);
  let clearing = $state(false);
  let notice = $state<string | null>(null);
  let dialogEl: HTMLDialogElement | null = null;
  let list: HTMLDivElement | null = null;
  let input: HTMLTextAreaElement | null = null;
  let socket: WebSocket | null = null;
  let drafts: DraftStore | null = null;
  let transcript = new PiTranscript();
  let retry: ReturnType<typeof setTimeout> | null = null;

  const turn = $derived(widgetTurn({ connected, busy, lastRole: messages.at(-1)?.role ?? null }));

  function textOf(message: PiChatMessage): string {
    if (message.role !== "assistant") return message.content;
    return message.parts.map((part) => (part.kind === "text" ? part.text : `[${part.tool.name}]`)).join("\n").trim();
  }

  function render() {
    messages = transcript.messages();
    busy = transcript.busy;
    void tick().then(() => list?.scrollTo({ top: list.scrollHeight }));
  }

  function connect(id: string) {
    if (socket) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/agents/pi-chat/${encodeURIComponent(id)}`);
    socket = ws;
    ws.onopen = () => { connected = true; };
    ws.onclose = () => {
      connected = false;
      if (socket !== ws) return;
      socket = null;
      if (open) retry = setTimeout(() => connect(id), 3000);
    };
    ws.onmessage = (event) => {
      let frame: { type?: string; view?: unknown; events?: Array<Record<string, unknown>>; entryTimes?: Record<string, number>; message?: string } = {};
      try { frame = JSON.parse(String(event.data)); } catch { return; }
      if (frame.type === "pi_snapshot") { transcript.applySnapshot(frame.view as Parameters<PiTranscript["applySnapshot"]>[0]); render(); }
      if (frame.type === "pi_events") { transcript.recordEntryTimes(frame.entryTimes); transcript.applyEvents(frame.events ?? []); render(); }
      if (frame.type === "pi_error") notice = String(frame.message ?? "Message failed");
    };
  }

  function disconnect() {
    if (retry) clearTimeout(retry);
    retry = null;
    const ws = socket;
    socket = null;
    ws?.close();
    connected = false;
  }

  async function loadChildren(id: string) {
    const response = await fetch(`/api/sessions/${encodeURIComponent(id)}/children`, { credentials: "include" }).catch(() => null);
    const body = await response?.json().catch(() => null);
    const rows = body?.result?.children;
    children = Array.isArray(rows) ? (rows as Child[]) : [];
  }

  async function ensureRoot(): Promise<string | null> {
    if (rootId) return rootId;
    loadError = null;
    const response = await fetch("/api/root", { credentials: "include" }).catch(() => null);
    const body = await response?.json().catch(() => null);
    if (!response?.ok || !body?.ok) { loadError = body?.error?.message ?? "Root is not available"; return null; }
    rootId = body.result.id as string;
    drafts = storageDraftStore(typeof localStorage === "undefined" ? undefined : localStorage, rootDraftKey(rootId));
    draft = drafts.get();
    return rootId;
  }

  async function openPanel() {
    open = true;
    if (dialogEl && !dialogEl.open) dialogEl.showModal();
    const id = await ensureRoot();
    if (!id) return;
    connect(id);
    void loadChildren(id);
    await tick();
    input?.focus();
  }

  function closePanel() {
    open = false;
    maximized = false;
    if (dialogEl?.open) dialogEl.close();
    disconnect();
  }

  function rememberDraft() {
    drafts?.set(draft);
  }

  function send(event?: SubmitEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    if (!socket || socket.readyState !== WebSocket.OPEN) { notice = "Not connected yet. Your message is kept."; return; }
    notice = null;
    socket.send(JSON.stringify({ type: "pi_submit", text, attachments: [], operationId: `root:${crypto.randomUUID()}` }));
    draft = "";
    rememberDraft();
  }

  function stop() {
    socket?.send(JSON.stringify({ type: "pi_abort" }));
  }

  async function clear() {
    if (!rootId || busy) return;
    if (!confirm("Clear this conversation? Its messages are removed.")) return;
    clearing = true;
    const response = await fetch("/api/root/clear", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: rootId }) }).catch(() => null);
    const body = await response?.json().catch(() => null);
    clearing = false;
    if (!response?.ok) { notice = body?.error?.message ?? "Clear failed"; return; }
    notice = null;
    transcript = new PiTranscript();
    render();
    disconnect();
    connect(rootId);
  }

  onMount(() => {
    const onOpen = () => { void openPanel(); };
    window.addEventListener("my-ax:root-open", onOpen);
    if (new URL(location.href).searchParams.get("action") === "root") void openPanel();
    return () => {
      window.removeEventListener("my-ax:root-open", onOpen);
      disconnect();
    };
  });
</script>

<button type="button" class="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-md text-fg-mut hover:text-fg hover:bg-surface-2" aria-label="Open root" title="Root" aria-haspopup="dialog" onclick={() => void openPanel()} data-root-button>
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="19" r="2" /><path d="M12 7v4M12 11l-6 6M12 11l6 6" /></svg>
</button>

<dialog bind:this={dialogEl} class="root-panel z-50 overflow-hidden border border-line bg-bg-alt p-0 text-fg" class:root-panel-max={maximized} onclose={() => { if (open) closePanel(); }} data-root-panel data-maximized={maximized ? "true" : "false"}>
  <div class="root-header safe-area-appbar">
    <div class="flex items-center gap-2 min-w-0">
      <span class="root-dot root-dot-{turn}" aria-hidden="true"></span>
      <span class="text-xs text-fg-mut" aria-live="polite">{widgetTurnLabel(turn)}</span>
    </div>
    <div class="flex items-center gap-2">
      {#if busy}<button type="button" class="root-chip root-stop" onclick={stop}>Stop</button>{/if}
      <button type="button" class="root-chip" onclick={clear} disabled={busy || clearing}>Clear</button>
      <button type="button" class="root-close" onclick={() => (maximized = !maximized)} aria-label={maximized ? "Restore size" : "Maximize"} aria-pressed={maximized} title={maximized ? "Restore size" : "Maximize"}>{maximized ? "⤡" : "⤢"}</button>
      <button type="button" class="root-close" onclick={closePanel} aria-label="Close">×</button>
    </div>
  </div>

  <div class="root-body">
    {#if loadError}
      <p class="root-empty text-bad">{loadError}</p>
    {:else}
      <div class="root-list" bind:this={list}>
        {#if !messages.length}<p class="root-empty">Ask about anything in my.ax. This conversation can see and organize all of it.</p>{/if}
        {#each messages as message (message.id)}
          <div class="root-msg root-msg-{message.role}">{textOf(message) || (message.streaming ? "…" : "")}</div>
        {/each}
      </div>
      {#if children.length}
        <div class="root-tree">
          <div class="root-tree-head">Started from here</div>
          {#each children as child (child.id)}
            <a class="root-child" href={`/?session=${encodeURIComponent(child.id)}`} onclick={closePanel}>
              <span class="root-dot root-dot-{child.status === 'running' ? 'working' : child.status === 'error' ? 'error' : 'idle'}" aria-hidden="true"></span>{child.name}
            </a>
          {/each}
        </div>
      {/if}
    {/if}
  </div>

  {#if !loadError}
    <form class="root-form" onsubmit={send}>
      {#if notice}<p class="root-notice" role="alert">{notice}</p>{/if}
      <textarea bind:this={input} bind:value={draft} oninput={rememberDraft} rows="2" placeholder="Message" aria-label="Message" onkeydown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }}></textarea>
      <div class="root-actions">
        <button type="submit" class="root-send" disabled={!draft.trim()}>Send</button>
      </div>
    </form>
  {/if}
</dialog>

<style>
  .root-panel {
    position: fixed;
    inset: max(0.5rem, env(safe-area-inset-top)) auto auto 50%;
    width: min(640px, calc(100vw - 1rem));
    height: min(720px, calc(100dvh - 1rem));
    max-height: calc(100dvh - 1rem);
    margin: 0;
    transform: translateX(-50%);
    border-radius: 16px;
    box-shadow: 0 28px 80px rgb(0 0 0 / 0.32), 0 2px 10px rgb(0 0 0 / 0.12);
  }
  .root-panel[open] { display: flex; flex-direction: column; }
  .root-panel::backdrop { background: rgb(0 0 0 / 0.56); backdrop-filter: blur(3px); }
  .root-panel-max {
    inset: 0;
    width: 100vw;
    max-width: 100vw;
    height: 100dvh;
    max-height: 100dvh;
    transform: none;
    border-radius: 0;
    border: 0;
  }
  .root-header {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 56px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--line);
    background: var(--bg-alt);
  }
  .root-close, .root-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 36px;
    min-width: 36px;
    padding: 0 8px;
    color: var(--fg-mut);
    border: 1px solid var(--line);
    border-radius: 7px;
    background: var(--bg);
    font-size: 13px;
    line-height: 1;
  }
  .root-close:hover, .root-chip:hover:not(:disabled) { color: var(--fg); background: var(--surface-2); }
  .root-chip:disabled { opacity: 0.45; }
  .root-stop { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 45%, var(--line)); }
  .root-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; display: inline-block; margin-right: 6px; }
  .root-dot-working { background: var(--good, #22c55e); animation: root-pulse 1.2s ease-in-out infinite; }
  .root-dot-idle { background: var(--fg-mut, #9ca3af); }
  .root-dot-error { background: var(--bad, #ef4444); }
  .root-dot-offline { background: var(--warn, #f59e0b); }
  @keyframes root-pulse { 50% { opacity: 0.35; } }
  .root-body { flex: 1; min-height: 0; display: flex; flex-direction: column; background: var(--bg-alt); }
  .root-list { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
  .root-panel-max .root-list { padding: 20px max(16px, calc((100vw - 760px) / 2)); }
  .root-msg { white-space: pre-wrap; word-break: break-word; line-height: 1.5; font-size: 0.92rem; }
  .root-msg-user { align-self: flex-end; background: var(--surface-2); padding: 8px 12px; border-radius: 12px; max-width: 85%; }
  .root-msg-error { color: var(--bad); background: color-mix(in srgb, var(--bad) 10%, transparent); padding: 8px 12px; border-radius: 10px; }
  .root-empty { padding: 2.5rem 1.25rem; text-align: center; color: var(--fg-mut); font-size: 0.875rem; }
  .root-tree { flex: none; border-top: 1px solid var(--line); padding: 10px 16px; display: flex; flex-direction: column; gap: 4px; max-height: 30%; overflow-y: auto; }
  .root-tree-head { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--fg-mut); }
  .root-child { color: var(--fg); text-decoration: none; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .root-child:hover { text-decoration: underline; }
  .root-form { flex: none; border-top: 1px solid var(--line); padding: 10px 12px; background: var(--bg-alt); }
  .root-panel-max .root-form { padding: 12px max(12px, calc((100vw - 760px) / 2)); }
  .root-notice { color: var(--bad); font-size: 13px; margin: 0 0 6px; }
  .root-form textarea { width: 100%; box-sizing: border-box; resize: none; border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; font: inherit; background: var(--bg); color: var(--fg); }
  .root-actions { display: flex; justify-content: flex-end; margin-top: 6px; }
  .root-send { background: var(--brand); color: #fff; border: 0; border-radius: 8px; padding: 6px 16px; font-weight: 600; }
  .root-send:disabled { opacity: 0.4; }
  @media (max-width: 639px) {
    .root-panel:not(.root-panel-max) {
      inset: auto 0 0 0;
      transform: none;
      width: 100vw;
      max-width: 100vw;
      height: calc(100dvh - max(2.5rem, env(safe-area-inset-top)));
      border-radius: 16px 16px 0 0;
    }
  }
</style>
