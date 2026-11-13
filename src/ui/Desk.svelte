<script lang="ts">
  import { portal } from "./portal";
  import { backgroundScale, dragOffset, revealProgress, rubberBand, settlesOpenAfterRelease, velocityOf } from "./top-drawer-drag";
  import { onMount } from "svelte";
  import { registerStatusRing } from "./paint-ring";
  import NavIconButton from "./NavIconButton.svelte";
  import { parseDeskBoard, type DeskBoard } from "../desk-board";
  import { parseDeskApp, type DeskApp } from "../desk-app";
  import { ArtifactOutboundBridge, type OutboundVerb } from "./artifact-outbound";
  import { handlePageCall, type PageCallFrame } from "./page-registry";

  let open = $state(false);
  type DeskDrag = { pointerId: number; startY: number; direction: "open" | "close"; height: number; offset: number; overshoot: number; moved: boolean; samples: Array<{ y: number; t: number }> };
  let drag = $state<DeskDrag | null>(null);
  const viewportHeight = () => window.innerHeight || 800;
  const offsetNow = $derived(drag ? drag.offset : open ? viewportHeight() : 0);
  const progress = $derived(revealProgress(offsetNow, drag?.height ?? viewportHeight()));
  $effect(() => {
    const root = document.documentElement;
    root.style.setProperty("--desk-progress", String(progress));
    root.style.setProperty("--desk-bg-scale", String(backgroundScale(progress)));
    root.dataset.deskDragging = drag ? "1" : "0";
    if (open || drag) {
      if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
      root.dataset.deskOpen = "1";
    } else if (root.dataset.deskOpen === "1" && !settleTimer) {
      settleTimer = setTimeout(() => { settleTimer = null; if (!open && !drag) root.dataset.deskOpen = "0"; }, DESK_SETTLE_MS);
    }
  });
  const DESK_SETTLE_MS = 460;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  function startDrag(event: PointerEvent, direction: "open" | "close") {
    if (event.button !== 0) return;
    const height = viewportHeight();
    drag = { pointerId: event.pointerId, startY: event.clientY, direction, height, offset: direction === "open" ? 0 : height, overshoot: 0, moved: false, samples: [{ y: event.clientY, t: event.timeStamp }] };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }
  function moveDrag(event: PointerEvent) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = event.clientY - drag.startY;
    const raw = drag.direction === "open" ? delta : drag.height + delta;
    const overshoot = raw > drag.height ? rubberBand(raw - drag.height) : 0;
    const samples = [...drag.samples.slice(-8), { y: event.clientY, t: event.timeStamp }];
    drag = { ...drag, offset: dragOffset(drag.startY, event.clientY, drag.height, drag.direction), overshoot, moved: drag.moved || Math.abs(delta) > 6, samples };
  }
  function endDrag(event: PointerEvent) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const finished = drag;
    drag = null;
    if (!finished.moved) {
      if (finished.direction === "open") void openPanel();
      return;
    }
    if (settlesOpenAfterRelease(finished.offset, finished.height, velocityOf(finished.samples))) void openPanel();
    else closePanel();
  }
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

<NavIconButton label="Open desk" title="Desk (click or pull down)" class="desk-button" aria-expanded={open} aria-controls="desk-drawer" onpointerdown={(event) => startDrag(event, "open")} onpointermove={moveDrag} onpointerup={endDrag} onpointercancel={endDrag} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openPanel(); } }}>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18" /></svg>
</NavIconButton>

<svelte:window onkeydown={(event) => { if (open && event.key === "Escape") closePanel(); }} />

<button use:portal type="button" class="desk-scrim" aria-label="Close desk" tabindex="-1" onclick={closePanel} data-open={open || drag ? "1" : "0"}></button>
<section use:portal id="desk-drawer" class="desk-drawer" data-desk-panel="" data-open={open ? "1" : "0"} data-dragging={drag ? "1" : "0"} aria-label="Desk" aria-hidden={!open && !drag} inert={!open}
  style:transform={drag ? `translateY(calc(-100% + ${drag.offset + drag.overshoot}px))` : undefined}>
  <button type="button" class="desk-drawer__close" onclick={closePanel} aria-label="Close desk" title="Close (Esc)">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
  </button>
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
  <div class="desk-drawer__handle" role="presentation" onpointerdown={(event) => startDrag(event, "close")} onpointermove={moveDrag} onpointerup={endDrag} onpointercancel={endDrag}>
    <span aria-hidden="true"></span>
  </div>
</section>

<style>
  :global(.desk-button) { touch-action: none; }
  .desk-scrim { position: fixed; inset: 0; z-index: 2147483000; border: 0; padding: 0; background: rgb(0 0 0 / 0.4); opacity: var(--desk-progress, 0); pointer-events: none; transition: opacity 500ms cubic-bezier(0.22, 1, 0.36, 1); }
  .desk-scrim[data-open="1"] { pointer-events: auto; }
  :global(html[data-desk-dragging="1"]) .desk-scrim { transition: none; }
  .desk-drawer { position: fixed; inset: 0 0 auto 0; height: 100dvh; z-index: 2147483001; display: flex; flex-direction: column; background: var(--bg); border-radius: 0 0 16px 16px; box-shadow: 0 12px 40px rgb(0 0 0 / 0.18); transform: translateY(calc(-100% - 48px)); transition: transform 420ms cubic-bezier(0.22, 1, 0.36, 1); will-change: transform; }
  .desk-drawer[data-open="1"] { transform: translateY(0); border-radius: 0; box-shadow: none; }
  .desk-drawer[data-dragging="1"] { transition: none; border-radius: 0 0 16px 16px; }
  .desk-drawer__handle { position: absolute; left: 50%; bottom: 0; width: 120px; transform: translateX(-50%); z-index: 2; display: grid; place-items: center; height: 28px; cursor: grab; touch-action: none; }
  .desk-drawer__handle:active { cursor: grabbing; }
  .desk-drawer__handle span { width: 44px; height: 5px; border-radius: 999px; background: color-mix(in srgb, var(--fg) 22%, transparent); }
  :global(html[data-desk-open="1"] body > div.contents > *) { transform: scale(var(--desk-bg-scale, 1)); transform-origin: 50% 100%; border-radius: calc(16px * var(--desk-progress, 0)); overflow: hidden; transition: transform 500ms cubic-bezier(0.22, 1, 0.36, 1), border-radius 500ms cubic-bezier(0.22, 1, 0.36, 1); }
  :global(html[data-desk-dragging="1"] body > div.contents > *) { transition: none; }
  .desk-drawer__close { position: absolute; z-index: 2; top: max(8px, env(safe-area-inset-top)); right: max(8px, env(safe-area-inset-right)); width: 40px; height: 40px; display: grid; place-items: center; border-radius: 6px; color: var(--fg-mut); background: transparent; }
  .desk-drawer__close:hover { color: var(--fg); background: var(--color-surface-2); }
  .desk-drawer__close:active { background: var(--color-surface-3); }
  .desk-drawer__body { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; }
  .desk-drawer__body > :global(:not(iframe)) { margin: 16px; }
  .desk-drawer__body :global(.desk-app-frame) { flex: 1; width: 100%; min-height: 0; border: 0; }
  @media (prefers-reduced-motion: reduce) { .desk-drawer, .desk-scrim { transition: none; } :global(html[data-desk-open="1"] body > div.contents > *) { transform: none; } }
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
