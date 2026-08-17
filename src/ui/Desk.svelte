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

<dialog bind:this={dialogEl} class="notif-dialog" onclose={() => { if (open) closePanel(); }} data-desk-panel>
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
              <div class="notif-pill">{card.status}</div>
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
