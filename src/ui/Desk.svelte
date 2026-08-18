<script lang="ts">
  import { onMount } from "svelte";
  import type { DeskBoard } from "../desk-board";

  let open = $state(false);
  let board = $state<DeskBoard>({ cards: [], updatedAt: "" });
  let error = $state<string | null>(null);
  let dialogEl: HTMLDialogElement | null = null;

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
    window.addEventListener("my-ax:desk-open", onOpen);
    if (new URL(location.href).searchParams.get("action") === "desk") void openPanel();
    return () => window.removeEventListener("my-ax:desk-open", onOpen);
  });
</script>

<button type="button" class="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-md text-fg-mut hover:text-fg hover:bg-surface-2" aria-label="Open desk" title="Desk" onclick={() => void openPanel()}>
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18" /></svg>
</button>

<dialog bind:this={dialogEl} class="notif-panel z-50 overflow-hidden border border-line bg-bg-alt p-0 text-fg" onclose={() => { if (open) closePanel(); }} data-desk-panel>
  <div class="notif-header safe-area-appbar">
    <h2 class="truncate text-sm font-semibold text-fg">Desk</h2>
    <button type="button" onclick={closePanel} class="notif-close" aria-label="Close desk">×</button>
  </div>
  <div class="notif-body">
    {#if error}
      <p class="notif-empty text-bad">{error}</p>
    {:else if board.cards.length === 0}
      <p class="notif-empty">Nothing on the desk. Agents write here with desk_upsert instead of a new conversation.</p>
    {:else}
      <ul class="notif-list">
        {#each board.cards as card (card.id)}
          <li class="notif-item">
            <div class="notif-item-main">
              <div class="notif-pill" data-tone={card.status === "rejected" ? "bad" : card.status === "approved" ? "ok" : "attention"}>{card.status}</div>
              <strong>{card.title}</strong>
              {#if card.body}<p class="notif-detail-body">{card.body}</p>{/if}
              <div class="flex gap-2 mt-2">
                {#if card.href}<a class="notif-detail-source" href={card.href} target="_blank" rel="noopener noreferrer">Open source</a>{/if}
                {#if card.decisionHref}<a class="notif-detail-source" href={card.decisionHref}>Decide</a>{/if}
              </div>
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
