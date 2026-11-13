<script lang="ts">
  import { portal } from "./portal";
  import { onMount } from "svelte";
  import { registerStatusRing } from "./paint-ring";
  import NavIconButton from "./NavIconButton.svelte";
  import { parseDeskBoard, type DeskBoard } from "../desk-board";
  import { parseDeskApp, type DeskApp } from "../desk-app";
  import { ArtifactOutboundBridge, type OutboundVerb } from "./artifact-outbound";
  import { handlePageCall, type PageCallFrame } from "./page-registry";

  let open = $state(false);
  let board = $state<DeskBoard>({ cards: [], updatedAt: "" });
  let deskApp = $state<DeskApp>({ artifactId: null, state: null, updatedAt: "", updatedBy: null });
  let error = $state<string | null>(null);
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
      board = body?.result ?? { cards: [], updatedAt: "" };
      error = null;
      window.dispatchEvent(new CustomEvent("my-ax:desk-board", { detail: board }));
    } catch (err) {
      error = err instanceof Error ? err.message : "desk unavailable";
    }
    await refreshApp();
  }

  async function removeCard(cardId: string) {
    try {
      const response = await fetch(`/api/desk/${encodeURIComponent(cardId)}`, { method: "DELETE", credentials: "include" });
      if (!response.ok) throw new Error("remove failed");
      const body = await response.json();
      board = parseDeskBoard(body?.result);
      error = null;
      window.dispatchEvent(new CustomEvent("my-ax:desk-board", { detail: board }));
    } catch (err) {
      error = err instanceof Error ? err.message : "remove failed";
    }
  }

  function closePanel() {
    open = false;
    const url = new URL(location.href);
    if (url.searchParams.get("action") === "desk") url.searchParams.delete("action");
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  async function openPanel() {
    open = true;
    const url = new URL(location.href);
    url.searchParams.set("action", "desk");
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    await refresh();
  }

  onMount(() => {
    registerStatusRing();
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

<NavIconButton label="Open desk" title="Desk" onclick={() => void openPanel()}>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18" /></svg>
</NavIconButton>

<svelte:window onkeydown={(event) => { if (open && event.key === "Escape") closePanel(); }} />

<section use:portal class="desk-drawer" data-desk-panel="" data-open={open ? "1" : "0"} aria-label="Desk" aria-hidden={!open} inert={!open}>
  <header class="desk-drawer__bar">
    <h2 class="desk-drawer__title">Desk</h2>
    <button type="button" class="desk-drawer__close" onclick={closePanel} aria-label="Close desk" title="Close (Esc)">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 15 6-6 6 6" /></svg>
    </button>
  </header>
  <div class="desk-drawer__body">
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
    {:else if board.cards.length === 0}
      <p class="notif-empty">The desk is empty. An agent can build one with deskWrite: point it at a widget for a full app, or write state for a simple board.</p>
    {:else}
      <ul class="notif-list">
        {#each board.cards as card (card.id)}
          <li class="notif-item">
            <div class="notif-item-main">
              <div class="notif-pill" data-ring={card.status} data-tone={card.status === "rejected" ? "bad" : card.status === "approved" ? "ok" : "attention"}>{card.status}</div>
              <strong>{card.title}</strong>
              {#if card.body}<p class="notif-detail-body">{card.body}</p>{/if}
              <div class="flex gap-2 mt-2">
                {#if card.href}<a class="notif-detail-source" href={card.href} target="_blank" rel="noopener noreferrer">Open source</a>{/if}
                {#if card.decisionHref}<a class="notif-detail-source" href={card.decisionHref}>Decide</a>{/if}
              </div>
            </div>
            <button type="button" class="desk-remove" aria-label={`Remove ${card.title}`} onclick={() => void removeCard(card.id)}>Remove</button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>

<style>
  .desk-drawer { position: fixed; inset: 0; z-index: 2147483001; display: flex; flex-direction: column; background: var(--bg); transform: translateY(-100%); transition: transform 340ms cubic-bezier(0.32, 0.72, 0, 1); }
  .desk-drawer[data-open="1"] { transform: translateY(0); box-shadow: 0 1px 0 var(--line); }
  .desk-drawer__bar { flex: none; display: flex; align-items: center; gap: 8px; height: var(--appbar-height, 52px); padding: 0 16px; border-bottom: 1px solid var(--line); }
  .desk-drawer__title { flex: 1; font-size: 14px; font-weight: 600; color: var(--fg); }
  .desk-drawer__close { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 8px; color: var(--fg-mut); }
  .desk-drawer__close:hover { background: var(--color-surface-1); color: var(--fg); }
  .desk-drawer__body { flex: 1; min-height: 0; overflow: auto; padding: 16px; display: flex; flex-direction: column; }
  .desk-drawer__body :global(.desk-app-frame) { flex: 1; width: 100%; min-height: 0; border: 0; }
  @media (prefers-reduced-motion: reduce) { .desk-drawer { transition: none; } }
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
  .desk-remove {
    align-self: center;
    flex: none;
    min-height: 32px;
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: 7px;
    background: var(--bg);
    color: var(--fg-mut);
    font-size: 12px;
    font-weight: 600;
  }
  .desk-remove:hover { color: var(--fg); background: var(--surface-2); }
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
  @supports (background: paint(status-ring)) {
    .notif-pill[data-ring] { background-image: paint(status-ring); --ring-progress: 1; --ring-width: 1.5; --ring-color: var(--brand); }
    .notif-pill[data-ring="approved"] { --ring-color: var(--good); }
    .notif-pill[data-ring="rejected"] { --ring-color: var(--bad); }
  }
</style>
