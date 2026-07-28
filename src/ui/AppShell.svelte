<script lang="ts">
  // 1:1 port of src/views/AppShell.tsx + chat.js's header-controls block
  // and connection-pill block.

  import { tick } from "svelte";
  import { sessionState, setActiveSession, wsState } from "@my-ax/store";
  import Attention from "./Attention.svelte";
  import RunReceiptModal from "./RunReceiptModal.svelte";

  interface Props {
    identityEmail?: string | null;
  }
  const { identityEmail = null }: Props = $props();

  function openSessions() {
    window.dispatchEvent(new Event("my-ax:sessions-toggle"));
  }
  function openSettings() {
    window.dispatchEvent(new Event("my-ax:settings-toggle"));
  }
  let editingTitle = $state(false);
  let titleDraft = $state("");
  let titleInput = $state<HTMLInputElement | null>(null);
  async function beginRename() {
    if (!sessionState.id) return;
    titleDraft = sessionState.title;
    editingTitle = true;
    await tick();
    titleInput?.focus();
    titleInput?.select();
  }
  function cancelRename() { editingTitle = false; }
  async function saveRename() {
    const id = sessionState.id;
    const title = titleDraft.trim();
    if (!id || !title) return cancelRename();
    if (title === sessionState.title) return cancelRename();
    const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: title }) });
    if (!response.ok) return;
    setActiveSession(id, title);
    window.dispatchEvent(new Event("my-ax:sessions-refresh"));
    editingTitle = false;
  }
  function renameKeydown(event: KeyboardEvent) {
    if (event.key === "Enter") { event.preventDefault(); void saveRename(); }
    else if (event.key === "Escape") { event.preventDefault(); cancelRename(); }
  }

  const connLabel = $derived(
    wsState.conn === "live"
      ? "connected"
      : wsState.conn === "reconnecting"
        ? "reconnecting…"
        : "offline",
  );
</script>

<header
  class="safe-area-appbar relative z-30 flex-none flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 border-b border-line bg-bg-alt/80 backdrop-blur text-fg min-h-[48px]"
  role="banner"
>
    <button
      type="button"
      onclick={openSessions}
      class="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-md text-fg-mut hover:text-fg hover:bg-surface-2 active:bg-surface-3 transition-colors"
      aria-label="Open conversations sidebar"
      aria-haspopup="dialog"
      title="Conversations"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="18" x2="21" y2="18" />
      </svg>
    </button>

  <div class="flex-1 min-w-0">
    {#if editingTitle}
      <input bind:this={titleInput} bind:value={titleDraft} onkeydown={renameKeydown} onblur={saveRename} maxlength={200} class="w-full min-w-0 rounded border border-brand/40 bg-bg px-2 py-1 text-sm text-fg outline-none" aria-label="Rename active conversation" />
    {:else}
      <button type="button" onclick={beginRename} disabled={!sessionState.id} class="group block max-w-full min-w-0 text-left disabled:cursor-default" aria-label={sessionState.id ? "Rename active conversation" : "New conversation"} title={sessionState.id ? "Rename active conversation" : "New conversation"}>
        <span class="flex items-center gap-1.5 min-w-0"><span class="block truncate text-[13px] font-medium text-fg">{sessionState.title}</span>{#if sessionState.id}<span class="hidden sm:inline text-[10px] text-fg-mut opacity-0 group-hover:opacity-70">✎</span>{/if}</span>
        {#if sessionState.id}<span data-active-session-id={sessionState.id} class="block font-mono text-[9px] leading-tight text-fg-mut/70">{sessionState.id.slice(0, 8)}</span>{/if}
      </button>
    {/if}
  </div>

  {#if identityEmail}
    <span id="identity-email-anchor" class="hidden" aria-hidden="true">{identityEmail}</span>
  {/if}

  <!-- Connection pill — reads from wsState.conn directly. -->
  <span
    data-state={wsState.conn}
    class="flex-shrink-0 inline-flex items-center justify-center gap-0 sm:gap-1.5 rounded-full sm:rounded-md w-10 h-10 sm:w-auto sm:h-auto sm:px-2 sm:py-1 text-[11px] font-medium data-[state=live]:bg-good/10 data-[state=live]:text-good data-[state=reconnecting]:bg-warn/10 data-[state=reconnecting]:text-warn data-[state=offline]:bg-bad/10 data-[state=offline]:text-bad"
    aria-live="polite"
    title="Connection status"
  >
    <span class="w-2 h-2 sm:w-1.5 sm:h-1.5 rounded-full" aria-hidden="true" style="background:currentColor"></span>
    <span class="hidden sm:inline">{connLabel}</span>
  </span>


  <Attention />

  <button
    id="settings-button"
    type="button"
    onclick={openSettings}
    class="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-md text-fg-mut hover:text-fg hover:bg-surface-2 active:bg-surface-3 transition-colors"
    aria-label="Settings"
    aria-haspopup="dialog"
    title="Settings"
  >
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  </button>
</header>

<RunReceiptModal />
