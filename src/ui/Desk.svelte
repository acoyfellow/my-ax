<script lang="ts">
  import { onMount } from "svelte";
  import { deskStatusTone, parseDeskBoard, type DeskBoard, type DeskCard } from "../desk-board";
  import { parseDeskApp, type DeskApp } from "../desk-app";
  import { ArtifactOutboundBridge, type OutboundVerb } from "./artifact-outbound";
  import { handlePageCall, type PageCallFrame } from "./page-registry";

  let open = $state(false);
  let board = $state<DeskBoard>({ cards: [], updatedAt: "" });
  let deskApp = $state<DeskApp>({ artifactId: null, state: null, updatedAt: "", updatedBy: null });
  let error = $state<string | null>(null);
  let replyDrafts = $state<Record<string, string>>({});
  let replyingCardId = $state<string | null>(null);
  let replyError = $state<{ cardId: string; message: string } | null>(null);
  let dialogEl: HTMLDialogElement | null = null;
  let appFrameEl: HTMLIFrameElement | null = null;

  const hostedArtifactId = $derived(deskApp.artifactId);

  const outbound = new ArtifactOutboundBridge({
    artifactIdForWindow: (source) => (appFrameEl && source === appFrameEl.contentWindow ? appFrameEl.getAttribute("data-artifact-id") : null),
    postToArtifact: (artifactId, frame) => {
      if (!appFrameEl || appFrameEl.getAttribute("data-artifact-id") !== artifactId) return false;
      const win = appFrameEl.contentWindow;
      if (!win) return false;
      try { win.postMessage(frame, "*"); return true; } catch { return false; }
    },
    runVerb: async (verb: OutboundVerb, args) => {
      const outcome = await handlePageCall({ type: "page_call", requestId: `desk-${verb}`, verb, args } as PageCallFrame);
      if (!outcome.frame.ok) throw new Error(outcome.frame.error || "host_invoke_failed");
      outcome.after?.();
      return outcome.frame.result ?? null;
    },
  });

  function activeTheme(): "light" | "dark" {
    if (document.documentElement.classList.contains("light")) return "light";
    if (document.documentElement.classList.contains("dark")) return "dark";
    return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }

  function pushStateToApp() {
    const id = deskApp.artifactId;
    if (!id || !appFrameEl) return;
    const win = appFrameEl.contentWindow;
    if (!win) return;
    try {
      win.postMessage({ type: "my-ax:artifact-theme", theme: activeTheme() }, "*");
      win.postMessage({ type: "my-ax:artifact-state", state: deskApp.state }, "*");
    } catch {}
  }

  async function refreshApp() {
    try {
      const response = await fetch("/api/desk/app", { credentials: "include" });
      if (!response.ok) return;
      const body = await response.json();
      deskApp = parseDeskApp(body?.result);
      pushStateToApp();
    } catch {}
  }

  async function refresh() {
    try {
      const response = await fetch("/api/desk", { credentials: "include" });
      if (!response.ok) throw new Error("desk unavailable");
      const body = await response.json();
      board = parseDeskBoard(body?.result);
      error = null;
      window.dispatchEvent(new CustomEvent("my-ax:desk-board", { detail: board }));
    } catch (err) {
      error = err instanceof Error ? err.message : "desk unavailable";
    }
    await refreshApp();
  }

  const liveCards = $derived(board.cards);

  async function replyToCard(card: DeskCard) {
    if (!card.reply || !card.originSessionId || replyingCardId) return;
    const response = replyDrafts[card.id]?.trim() ?? "";
    if (!response) {
      replyError = { cardId: card.id, message: "Write a reply before sending." };
      return;
    }
    replyingCardId = card.id;
    replyError = null;
    try {
      const result = await fetch(`/api/desk/${encodeURIComponent(card.id)}/reply`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ response }),
      });
      const body = await result.json().catch(() => null);
      if (!result.ok) throw new Error(body?.error?.message || "reply unavailable");
      board = parseDeskBoard(body?.result);
      replyDrafts = { ...replyDrafts, [card.id]: "" };
      window.dispatchEvent(new CustomEvent("my-ax:desk-board", { detail: board }));
    } catch (err) {
      replyError = { cardId: card.id, message: err instanceof Error ? err.message : "reply unavailable" };
    } finally {
      replyingCardId = null;
    }
  }

  function closePanel() {
    open = false;
    const url = new URL(location.href);
    if (url.searchParams.get("action") === "desk") url.searchParams.delete("action");
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    if (dialogEl?.open) dialogEl.close();
  }

  async function openPanel() {
    open = true;
    const url = new URL(location.href);
    url.searchParams.set("action", "desk");
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    if (dialogEl && !dialogEl.open) dialogEl.showModal();
    await refresh();
  }

  onMount(() => {
    const onOpen = () => { void openPanel(); };
    const onBoard = (event: Event) => {
      const next = parseDeskBoard((event as CustomEvent).detail);
      board = next;
      error = null;
    };
    const onAppState = (event: Event) => {
      deskApp = parseDeskApp((event as CustomEvent).detail);
      pushStateToApp();
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "my-ax:host-invoke") { void outbound.handleCall(event.source, data); return; }
      if (data.type === "my-ax:desk-app-write") { void refreshApp(); }
    };
    window.addEventListener("my-ax:desk-open", onOpen);
    window.addEventListener("my-ax:desk-board", onBoard);
    window.addEventListener("my-ax:desk-app", onAppState);
    window.addEventListener("message", onMessage);
    void refreshApp();
    if (new URL(location.href).searchParams.get("action") === "desk") void openPanel();
    return () => {
      window.removeEventListener("my-ax:desk-open", onOpen);
      window.removeEventListener("my-ax:desk-board", onBoard);
      window.removeEventListener("my-ax:desk-app", onAppState);
      window.removeEventListener("message", onMessage);
    };
  });
</script>

<button type="button" class="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-md text-fg-mut hover:text-fg hover:bg-surface-2" aria-label="Open desk" title="Desk" onclick={() => void openPanel()}>
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18" /></svg>
</button>

<dialog bind:this={dialogEl} class="notif-panel z-50 overflow-hidden border border-line bg-bg-alt p-0 text-fg" onclose={() => { if (open) closePanel(); }} data-desk-panel>
  <div class="notif-header safe-area-appbar">
    <h2 class="truncate text-sm font-semibold text-fg">Desk</h2>
    <div class="flex items-center gap-2">
      <button type="button" onclick={closePanel} class="notif-close" aria-label="Close desk">×</button>
    </div>
  </div>
  <div class="notif-body">
    {#if hostedArtifactId}
      <iframe
        bind:this={appFrameEl}
        class="desk-app-frame"
        title="Desk"
        data-artifact-id={hostedArtifactId}
        src={`/api/artifacts/${encodeURIComponent(hostedArtifactId)}/preview`}
        sandbox="allow-scripts"
        referrerpolicy="no-referrer"
        onload={pushStateToApp}
      ></iframe>
    {:else if error}
      <p class="notif-empty text-bad">{error}</p>
    {:else if liveCards.length === 0}
      <p class="notif-empty">The desk is empty. An agent can build one with deskWrite: point it at an artifact for a full app, or write state for a simple board.</p>
    {:else}
      <ul class="notif-list">
        {#each liveCards as card (card.id)}
          <li class="notif-item">
            <div class="notif-item-main">
              {#if card.status}<div class="notif-pill" data-tone={deskStatusTone(card.status)}>{card.status}</div>{/if}
              <strong>{card.title}</strong>
              {#if card.agent}<p class="desk-card-agent">Agent: {card.agent}</p>{/if}
              {#if card.body}<p class="notif-detail-body">{card.body}</p>{/if}
              {#if card.href || card.actionHref}
                <div class="flex gap-2 mt-2">
                  {#if card.href}<a class="notif-detail-source" href={card.href} target="_blank" rel="noopener noreferrer">Open source</a>{/if}
                  {#if card.actionHref}<a class="notif-detail-source" href={card.actionHref}>{card.actionLabel}</a>{/if}
                </div>
              {/if}
              {#if card.reply && card.originSessionId}
                <form class="desk-reply" onsubmit={(event) => { event.preventDefault(); void replyToCard(card); }}>
                  <label for={`desk-reply-${card.id}`}>{card.reply.prompt}</label>
                  <textarea id={`desk-reply-${card.id}`} bind:value={replyDrafts[card.id]} placeholder={card.reply.placeholder} maxlength="3000" required></textarea>
                  {#if replyError?.cardId === card.id}<p class="desk-reply-error">{replyError.message}</p>{/if}
                  <button type="submit" disabled={replyingCardId !== null}>{replyingCardId === card.id ? "Sending…" : card.reply.label}</button>
                </form>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</dialog>

<style>
  .notif-panel {
    position: fixed;
    inset: max(0.5rem, env(safe-area-inset-top)) auto auto 50%;
    width: min(460px, calc(100vw - 1rem));
    height: auto;
    max-height: min(680px, calc(100dvh - 1rem));
    margin: 0;
    transform: translateX(-50%);
    border-radius: 16px;
    box-shadow: 0 28px 80px rgb(0 0 0 / 0.32), 0 2px 10px rgb(0 0 0 / 0.12);
  }
  .notif-panel[open] { display: flex; flex-direction: column; }
  .notif-panel::backdrop { background: rgb(0 0 0 / 0.56); backdrop-filter: blur(3px); }
  .notif-header {
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
  .notif-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 36px;
    min-width: 36px;
    color: var(--fg-mut);
    border: 1px solid var(--line);
    border-radius: 7px;
    background: var(--bg);
    font-size: 14px;
    line-height: 1;
  }
  .notif-close:hover { color: var(--fg); background: var(--surface-2); }
  .notif-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    background: var(--bg-alt);
  }
  .notif-empty {
    padding: 2.5rem 1.25rem;
    text-align: center;
    color: var(--fg-mut);
    font-size: 0.875rem;
  }
  .desk-app-frame {
    display: block;
    width: 100%;
    height: min(560px, calc(100dvh - 8rem));
    border: 0;
    background: var(--bg);
  }
  .notif-list { display: flex; flex-direction: column; }
  .notif-item {
    display: flex;
    align-items: stretch;
    gap: 6px;
    padding: 10px 10px 10px 12px;
    border-bottom: 1px solid color-mix(in srgb, var(--line) 60%, transparent);
    position: relative;
  }
  .notif-item-main { display: block; min-width: 0; flex: 1; }
  .notif-detail-body {
    margin-top: 8px;
    white-space: pre-wrap;
    font-size: 0.88rem;
    line-height: 1.5;
    color: var(--fg);
  }
  .notif-detail-source {
    margin-top: 8px;
    border-radius: 0.5rem;
    background: var(--brand);
    padding: 0.4rem 0.7rem;
    font-size: 0.75rem;
    font-weight: 700;
    color: white;
  }
  .desk-card-agent {
    margin-top: 5px;
    font-size: 0.75rem;
    color: var(--fg-mut);
  }
  .desk-reply {
    display: grid;
    gap: 7px;
    margin-top: 12px;
  }
  .desk-reply label {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--fg);
  }
  .desk-reply textarea {
    min-height: 72px;
    resize: vertical;
    border: 1px solid var(--line);
    border-radius: 0.5rem;
    background: var(--bg);
    padding: 0.55rem 0.65rem;
    color: var(--fg);
    font: inherit;
  }
  .desk-reply button {
    justify-self: start;
    border: 0;
    border-radius: 0.5rem;
    background: var(--brand);
    padding: 0.45rem 0.75rem;
    color: white;
    font-size: 0.75rem;
    font-weight: 700;
  }
  .desk-reply button:disabled { cursor: default; opacity: 0.6; }
  .desk-reply-error { color: var(--bad); font-size: 0.8rem; }
  .notif-pill {
    flex: none;
    display: inline-flex;
    align-items: center;
    padding: 1px 7px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 500;
    border: 1px solid var(--line);
    color: var(--fg-mut);
  }
  .notif-pill[data-tone="bad"] { border-color: color-mix(in srgb, var(--bad) 45%, var(--line)); color: var(--bad); background: color-mix(in srgb, var(--bad) 10%, transparent); }
  .notif-pill[data-tone="attention"] { border-color: color-mix(in srgb, var(--brand) 50%, var(--line)); color: var(--brand); background: color-mix(in srgb, var(--brand) 10%, transparent); }
  .notif-pill[data-tone="ok"] { border-color: color-mix(in srgb, #16a34a 45%, var(--line)); color: #16a34a; background: color-mix(in srgb, #16a34a 10%, transparent); }
  @media (max-width: 639px) {
    .notif-panel {
      inset: auto 0 0 0;
      transform: none;
      width: 100vw;
      max-width: 100vw;
      max-height: calc(100dvh - max(2.5rem, env(safe-area-inset-top)));
      border-radius: 16px 16px 0 0;
    }
  }
</style>
