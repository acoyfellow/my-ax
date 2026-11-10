<script lang="ts">
  import { onMount, tick } from "svelte";
  import { PiTranscript, type PiChatMessage } from "./pi-transcript";
  import { pipCapability, rootDraftKey, storageDraftStore, widgetTurn, widgetTurnLabel, type DraftStore } from "./root-widget-state";

  type Child = { id: string; name: string; status: string };

  let rootId = $state<string | null>(null);
  let loadError = $state<string | null>(null);
  let connected = $state(false);
  let busy = $state(false);
  let messages = $state<PiChatMessage[]>([]);
  let children = $state<Child[]>([]);
  let draft = $state("");
  let open = $state(false);
  let floating = $state(false);
  let clearing = $state(false);
  let notice = $state<string | null>(null);
  let shell: HTMLDivElement | null = null;
  let home: HTMLDivElement | null = null;
  let list: HTMLDivElement | null = null;
  let pipWindow: Window | null = null;
  let socket: WebSocket | null = null;
  let drafts: DraftStore | null = null;
  let transcript = new PiTranscript();
  let retry: ReturnType<typeof setTimeout> | null = null;

  const pip = $derived(pipCapability(typeof window === "undefined" ? undefined : (window as unknown as { documentPictureInPicture?: unknown; isSecureContext?: boolean })));
  const turn = $derived(widgetTurn({ connected, busy, lastRole: messages.at(-1)?.role ?? null }));
  const recent = $derived(messages.slice(-12));

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
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/agents/pi-chat/${encodeURIComponent(id)}`);
    socket = ws;
    ws.onopen = () => { connected = true; };
    ws.onclose = () => {
      connected = false;
      if (socket === ws) retry = setTimeout(() => connect(id), 3000);
    };
    ws.onmessage = (event) => {
      let frame: { type?: string; view?: unknown; events?: Array<Record<string, unknown>>; entryTimes?: Record<string, number>; message?: string } = {};
      try { frame = JSON.parse(String(event.data)); } catch { return; }
      if (frame.type === "pi_snapshot") { transcript.applySnapshot(frame.view as Parameters<PiTranscript["applySnapshot"]>[0]); render(); }
      if (frame.type === "pi_events") { transcript.recordEntryTimes(frame.entryTimes); transcript.applyEvents(frame.events ?? []); render(); }
      if (frame.type === "pi_error") { notice = String(frame.message ?? "Message failed"); }
    };
  }

  async function loadChildren(id: string) {
    const response = await fetch(`/api/sessions/${encodeURIComponent(id)}/children`, { credentials: "include" }).catch(() => null);
    const body = await response?.json().catch(() => null);
    const rows = body?.result?.children;
    children = Array.isArray(rows) ? (rows as Child[]) : [];
  }

  async function loadRoot() {
    loadError = null;
    const response = await fetch("/api/root", { credentials: "include" }).catch(() => null);
    const body = await response?.json().catch(() => null);
    if (!response?.ok || !body?.ok) { loadError = body?.error?.message ?? "Root is not available"; return; }
    rootId = body.result.id as string;
    drafts = storageDraftStore(typeof localStorage === "undefined" ? undefined : localStorage, rootDraftKey(rootId));
    draft = drafts.get();
    connect(rootId);
    void loadChildren(rootId);
  }

  function rememberDraft() {
    drafts?.set(draft);
  }

  function send(event?: SubmitEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || !socket || socket.readyState !== WebSocket.OPEN) {
      if (text) notice = "Not connected yet. Your message is kept.";
      return;
    }
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
    if (!confirm("Clear root? Its messages are removed. Root stays.")) return;
    clearing = true;
    const response = await fetch("/api/root/clear", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: rootId }) }).catch(() => null);
    const body = await response?.json().catch(() => null);
    clearing = false;
    if (!response?.ok) { notice = body?.error?.message ?? "Clear failed"; return; }
    notice = null;
  }

  function copyStyles(target: Document) {
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const style = target.createElement("style");
        style.textContent = Array.from(sheet.cssRules).map((rule) => rule.cssText).join("\n");
        target.head.append(style);
      } catch {
        if (sheet.href) {
          const link = target.createElement("link");
          link.rel = "stylesheet";
          link.href = sheet.href;
          target.head.append(link);
        }
      }
    }
  }

  function dockHome() {
    if (shell && home && shell.parentElement !== home) home.append(shell);
    floating = false;
    pipWindow = null;
  }

  async function popOut() {
    if (!pip.available) { notice = pip.reason; return; }
    rememberDraft();
    const api = (window as unknown as { documentPictureInPicture: { requestWindow(options: { width: number; height: number }): Promise<Window> } }).documentPictureInPicture;
    try {
      pipWindow = await api.requestWindow({ width: 380, height: 520 });
    } catch (error) {
      notice = `Could not open the floating window: ${error instanceof Error ? error.message : String(error)}`;
      return;
    }
    copyStyles(pipWindow.document);
    pipWindow.document.body.style.margin = "0";
    if (shell) pipWindow.document.body.append(shell);
    floating = true;
    open = true;
    pipWindow.addEventListener("pagehide", dockHome);
  }

  function popIn() {
    const win = pipWindow;
    dockHome();
    win?.close();
  }

  onMount(() => {
    void loadRoot();
    const poll = setInterval(() => { if (rootId) void loadChildren(rootId); }, 15000);
    return () => {
      clearInterval(poll);
      if (retry) clearTimeout(retry);
      const ws = socket;
      socket = null;
      ws?.close();
      pipWindow?.close();
    };
  });
</script>

<div bind:this={home} class="root-home" class:root-home-floating={floating}>
  <div bind:this={shell} class="root-widget" class:root-widget-open={open || floating} class:root-widget-floating={floating} data-testid="root-widget" data-place={floating ? "floating" : "inline"}>
    <div class="root-bar">
      <span class="root-dot root-dot-{turn}" aria-hidden="true"></span>
      <button type="button" class="root-title" onclick={() => (open = !open)} aria-expanded={open || floating}>
        Root <span class="root-state">{widgetTurnLabel(turn)}</span>
      </button>
      {#if busy}<button type="button" class="root-btn root-stop" onclick={stop}>Stop</button>{/if}
      {#if floating}
        <button type="button" class="root-btn" onclick={popIn} title="Back into the page">⤓</button>
      {:else if pip.available}
        <button type="button" class="root-btn" onclick={popOut} title="Float above other windows">⧉</button>
      {:else}
        <span class="root-btn root-btn-off" title={pip.reason}>⧉</span>
      {/if}
    </div>

    {#if open || floating}
      <div class="root-body">
        {#if loadError}
          <p class="root-error">{loadError}</p>
        {:else}
          <div class="root-list" bind:this={list}>
            {#if !recent.length}<p class="root-empty">Ask root anything. It can see and organize all of your my.ax.</p>{/if}
            {#each recent as message (message.id)}
              <div class="root-msg root-msg-{message.role}">{textOf(message) || (message.streaming ? "…" : "")}</div>
            {/each}
          </div>
          {#if children.length}
            <div class="root-tree">
              <div class="root-tree-head">Started by root</div>
              {#each children as child (child.id)}
                <a class="root-child" href={`/?session=${encodeURIComponent(child.id)}`} target="_top">
                  <span class="root-dot root-dot-{child.status === 'running' ? 'working' : child.status === 'error' ? 'error' : 'idle'}" aria-hidden="true"></span>{child.name}
                </a>
              {/each}
            </div>
          {/if}
          {#if notice}<p class="root-error" role="alert">{notice}</p>{/if}
          <form class="root-form" onsubmit={send}>
            <textarea bind:value={draft} oninput={rememberDraft} rows="2" placeholder="Message root" aria-label="Message root" onkeydown={(event) => { if (event.key === "Enter" && !event.shiftKey) send(); }}></textarea>
            <div class="root-actions">
              <button type="button" class="root-btn" onclick={clear} disabled={busy || clearing}>Clear</button>
              <button type="submit" class="root-send" disabled={!draft.trim()}>Send</button>
            </div>
          </form>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .root-home { position: fixed; right: 16px; bottom: 88px; z-index: 45; }
  .root-home-floating { display: none; }
  .root-widget { width: 20rem; max-width: calc(100vw - 32px); background: var(--color-bg-alt, #fff); color: var(--color-fg, #111); border: 1px solid var(--color-line, #e5e7eb); border-radius: 14px; box-shadow: 0 8px 28px rgba(0,0,0,.14); font: 14px system-ui, sans-serif; overflow: hidden; }
  .root-widget-floating { width: 100%; max-width: none; height: 100vh; border: 0; border-radius: 0; box-shadow: none; display: flex; flex-direction: column; }
  .root-bar { display: flex; align-items: center; gap: 8px; padding: 10px 12px; }
  .root-title { flex: 1; text-align: left; background: none; border: 0; font-weight: 600; cursor: pointer; color: inherit; padding: 0; }
  .root-state { font-weight: 400; color: var(--color-fg-mut, #6b7280); margin-left: 6px; font-size: 12px; }
  .root-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; display: inline-block; margin-right: 6px; }
  .root-dot-working { background: #22c55e; animation: root-pulse 1.2s ease-in-out infinite; }
  .root-dot-idle { background: #9ca3af; }
  .root-dot-error { background: #ef4444; }
  .root-dot-offline { background: #f59e0b; }
  @keyframes root-pulse { 50% { opacity: .35; } }
  .root-btn { background: none; border: 0; cursor: pointer; color: var(--color-fg-mut, #6b7280); font-size: 13px; padding: 2px 6px; border-radius: 6px; }
  .root-btn:hover:not(:disabled) { color: inherit; background: rgba(0,0,0,.05); }
  .root-btn-off { opacity: .35; cursor: help; }
  .root-stop { background: #fee2e2; color: #b91c1c; font-weight: 600; }
  .root-body { border-top: 1px solid var(--color-line, #e5e7eb); display: flex; flex-direction: column; min-height: 0; flex: 1; }
  .root-list { max-height: 18rem; overflow-y: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
  .root-widget-floating .root-list { max-height: none; flex: 1; }
  .root-msg { white-space: pre-wrap; word-break: break-word; line-height: 1.4; }
  .root-msg-user { align-self: flex-end; background: var(--color-bg, #f3f4f6); padding: 6px 10px; border-radius: 10px; max-width: 85%; }
  .root-msg-error { color: #b91c1c; background: #fef2f2; padding: 6px 10px; border-radius: 8px; }
  .root-empty { color: var(--color-fg-mut, #6b7280); margin: 0; }
  .root-error { color: #b91c1c; margin: 6px 12px; font-size: 13px; }
  .root-tree { border-top: 1px solid var(--color-line, #e5e7eb); padding: 8px 12px; display: flex; flex-direction: column; gap: 4px; }
  .root-tree-head { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--color-fg-mut, #6b7280); }
  .root-child { color: inherit; text-decoration: none; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .root-form { border-top: 1px solid var(--color-line, #e5e7eb); padding: 8px 12px; }
  .root-form textarea { width: 100%; box-sizing: border-box; resize: none; border: 1px solid var(--color-line, #e5e7eb); border-radius: 8px; padding: 6px 8px; font: inherit; background: var(--color-bg, #fff); color: inherit; }
  .root-actions { display: flex; justify-content: space-between; margin-top: 6px; }
  .root-send { background: #f6821f; color: #fff; border: 0; border-radius: 8px; padding: 5px 14px; font-weight: 600; cursor: pointer; }
  .root-send:disabled { opacity: .4; cursor: default; }
</style>
