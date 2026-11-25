<script lang="ts">
  // 1:1 port of src/views/AppShell.tsx + chat.js's header-controls block
  // and connection-pill block.

  import { onMount, tick } from "svelte";
  import { startTabLeader } from "./tab-leader.svelte";
  import { startKeyboardInset } from "./keyboard-inset.svelte";
  import { sessionState, setActiveSession } from "@my-ax/store";
  import Attention from "./Attention.svelte";
  import Alert from "./Alert.svelte";
  import Desk from "./Desk.svelte";
  import RunReceiptModal from "./RunReceiptModal.svelte";
  import NavIconButton from "./NavIconButton.svelte";
  import ActivitySignal from "./ActivitySignal.svelte";
  import AppPopOut from "./AppPopOut.svelte";
  import VoiceListen from "./VoiceListen.svelte";
  import Miniplayer from "./Miniplayer.svelte";

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

  let hasAgentOverrides = $state(false);
  function openAgentSettings() {
    if (!sessionState.id) return;
    window.dispatchEvent(new CustomEvent("my-ax:agent-settings-open", { detail: { sessionId: sessionState.id, title: sessionState.title } }));
  }
  function onOverrides(event: Event) {
    const detail = (event as CustomEvent<{ active?: boolean }>).detail;
    hasAgentOverrides = Boolean(detail?.active);
  }
  function onSaved(event: Event) {
    const settings = (event as CustomEvent<{ settings?: Record<string, unknown> }>).detail?.settings;
    hasAgentOverrides = Boolean(settings && Object.values(settings).some((value) => value !== null && value !== false));
  }

  let appBarHeight = $state(52);
  $effect(() => {
    document.documentElement.style.setProperty("--appbar-height", `${appBarHeight}px`);
  });

  onMount(() => {
    startKeyboardInset();
    startTabLeader();
    window.addEventListener("my-ax:agent-settings-overrides", onOverrides);
    window.addEventListener("my-ax:agent-settings-saved", onSaved);
    return () => {
      window.removeEventListener("my-ax:agent-settings-overrides", onOverrides);
      window.removeEventListener("my-ax:agent-settings-saved", onSaved);
    };
  });
</script>

<header
  bind:offsetHeight={appBarHeight}
  class="safe-area-appbar relative z-30 flex-none flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 border-b border-line bg-bg-alt text-fg min-h-[52px]"
  role="banner"
>
    <NavIconButton label="Toggle conversations sidebar" title="Conversations (⌘B)" onclick={openSessions} aria-controls="sessions-panel">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg>
    </NavIconButton>

  {#if sessionState.id}<ActivitySignal />{/if}

  <div class="flex-1 min-w-0">
    {#if editingTitle}
      <input bind:this={titleInput} bind:value={titleDraft} onkeydown={renameKeydown} onblur={saveRename} maxlength={200} class="w-full min-w-0 rounded border border-brand/40 bg-bg px-2 py-1 text-sm text-fg outline-none" aria-label="Rename active conversation" />
    {:else}
      <button type="button" onclick={beginRename} disabled={!sessionState.id} class="group block max-w-full min-w-0 text-left disabled:cursor-default" aria-label={sessionState.id ? "Rename active conversation" : "New conversation"} title={sessionState.id ? "Rename active conversation" : "New conversation"}>
        <span class="flex items-center gap-1.5 min-w-0">{#if sessionState.id}<span class="block truncate text-sm font-semibold text-fg">{sessionState.title}</span>{/if}{#if sessionState.id}<span class="hidden sm:inline text-sm text-fg-mut opacity-0 group-hover:opacity-70">✎</span>{/if}</span>
        {#if sessionState.id}<span data-active-session-id={sessionState.id} class="block font-mono text-[0.8em] leading-tight text-fg-mut/70">{sessionState.id.slice(0, 8)}</span>{/if}
      </button>
    {/if}
  </div>


  <VoiceListen />

  {#if sessionState.id}
    <NavIconButton label="Agent settings" title="Agent settings" data-agent-settings-trigger onclick={openAgentSettings} class="relative">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/></svg>
      {#if hasAgentOverrides}<span class="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-brand" aria-hidden="true"></span>{/if}
    </NavIconButton>
  {/if}

  <AppPopOut />


  <Desk />

  <Attention />
  <Alert />

  <NavIconButton id="settings-button" label="Settings" onclick={openSettings} aria-haspopup="dialog">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  </NavIconButton>
</header>

<RunReceiptModal />

{#if typeof localStorage !== "undefined" && localStorage.getItem("my-ax-miniplayer") === "1"}
  <Miniplayer />
{/if}
