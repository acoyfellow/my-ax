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
  type ContextSummary = { activeTokens: number; compactAtTokens: number; percentOfCompact: number; compacting: boolean; compactionCount: number };
  let contextSummary = $state<ContextSummary | null>(null);
  const formatTokens = (tokens: number) => (tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(1)}M` : tokens >= 1000 ? `${(tokens / 1000).toFixed(tokens >= 100_000 ? 0 : 1)}K` : String(tokens));
  const contextTone = $derived(!contextSummary ? "ok" : contextSummary.percentOfCompact > 85 ? "hot" : contextSummary.percentOfCompact >= 65 ? "warm" : "ok");
  function openContext() {
    if (!sessionState.id) return;
    window.dispatchEvent(new CustomEvent("my-ax:agent-settings-open", { detail: { sessionId: sessionState.id, title: sessionState.title, section: "context" } }));
  }
  function onContextSummary(event: Event) {
    const detail = (event as CustomEvent<{ sessionId?: string; summary?: ContextSummary }>).detail;
    if (detail?.sessionId === sessionState.id && detail.summary) contextSummary = detail.summary;
  }
  async function fetchContextSummary(id: string) {
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(id)}/context`);
      if (!response.ok || sessionState.id !== id) return;
      const body = await response.json().catch(() => null);
      const r = body?.result;
      if (!r || typeof r.activeTokens !== "number") return;
      contextSummary = {
        activeTokens: r.activeTokens,
        compactAtTokens: r.compactAtTokens,
        percentOfCompact: r.percentOfCompact,
        compacting: Boolean(r.compacting),
        compactionCount: Number(r.compactionCount ?? 0),
      };
    } catch {}
  }
  function onContextRefresh() {
    if (sessionState.id) void fetchContextSummary(sessionState.id);
  }
  function onCompactingEvent(event: Event) {
    const detail = (event as CustomEvent<{ sessionId?: string; compacting?: boolean }>).detail;
    if (detail?.sessionId === sessionState.id && contextSummary) {
      contextSummary = { ...contextSummary, compacting: Boolean(detail.compacting) };
    }
  }
  $effect(() => {
    const id = sessionState.id;
    contextSummary = null;
    if (id) void fetchContextSummary(id);
  });
  function onOverrides(event: Event) {
    const detail = (event as CustomEvent<{ active?: boolean }>).detail;
    hasAgentOverrides = Boolean(detail?.active);
  }
  function onSaved(event: Event) {
    const settings = (event as CustomEvent<{ settings?: Record<string, unknown> }>).detail?.settings;
    hasAgentOverrides = Boolean(settings && Object.entries(settings).some(([key, value]) => (key === "context" ? Object.values((value as Record<string, unknown>) ?? {}).some((inner) => inner !== null) : value !== null && value !== false)));
    if (sessionState.id) void fetchContextSummary(sessionState.id);
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
    window.addEventListener("my-ax:context-summary", onContextSummary);
    window.addEventListener("my-ax:context-refresh", onContextRefresh);
    window.addEventListener("my-ax:context-compacting", onCompactingEvent);
    return () => {
      window.removeEventListener("my-ax:context-compacting", onCompactingEvent);
      window.removeEventListener("my-ax:context-refresh", onContextRefresh);
      window.removeEventListener("my-ax:context-summary", onContextSummary);
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

  {#if sessionState.id}<span class="appbar-signal"><ActivitySignal /></span>{/if}

  <div class="flex-1 min-w-0 overflow-hidden">
    {#if editingTitle}
      <input bind:this={titleInput} bind:value={titleDraft} onkeydown={renameKeydown} onblur={saveRename} maxlength={200} class="w-full min-w-0 rounded border border-brand/40 bg-bg px-2 py-1 text-sm text-fg outline-none" aria-label="Rename active conversation" />
    {:else}
      <button type="button" onclick={beginRename} disabled={!sessionState.id} class="group block w-full max-w-full min-w-0 overflow-hidden text-left disabled:cursor-default" aria-label={sessionState.id ? "Rename active conversation" : "New conversation"} title={sessionState.id ? "Rename active conversation" : "New conversation"}>
        <span class="flex items-center gap-1.5 min-w-0">{#if sessionState.id}<span class="block truncate text-sm font-semibold text-fg">{sessionState.title}</span>{/if}{#if sessionState.id}<span class="hidden sm:inline text-sm text-fg-mut opacity-0 group-hover:opacity-70">✎</span>{/if}</span>
        {#if sessionState.id}<span data-active-session-id={sessionState.id} class="appbar-session-id block truncate font-mono text-[0.8em] leading-tight text-fg-mut/70">{sessionState.id.slice(0, 8)}</span>{/if}
      </button>
    {/if}
  </div>


  <span class="appbar-voice"><VoiceListen /></span>

  {#if sessionState.id && contextSummary}
    <button type="button" data-context-pill data-tone={contextSummary.compacting ? "compacting" : contextTone} onclick={openContext} class="context-pill" title="Context window: click to manage" aria-label={contextSummary.compacting ? "Compacting context" : `Context ${formatTokens(contextSummary.activeTokens)} of ${formatTokens(contextSummary.compactAtTokens)} tokens`}>
      <span class="context-pill__dot" aria-hidden="true"></span>
      <span class="context-pill__text">{contextSummary.compacting ? "Compacting…" : `${formatTokens(contextSummary.activeTokens)} / ${formatTokens(contextSummary.compactAtTokens)}`}</span>
      <span class="context-pill__bar" aria-hidden="true"><span style:width={`${contextSummary.percentOfCompact}%`}></span></span>
    </button>
  {/if}

  {#if sessionState.id}
    <NavIconButton label="Agent settings" title="Agent settings" data-agent-settings-trigger onclick={openAgentSettings} class="relative">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/></svg>
      {#if hasAgentOverrides}<span class="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-brand" aria-hidden="true"></span>{/if}
    </NavIconButton>
  {/if}

  <span class="appbar-pip"><AppPopOut /></span>

  <span class="appbar-desk"><Desk /></span>

  <span class="appbar-bell"><Attention /></span>
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

<style>
  .appbar-signal, .appbar-voice, .appbar-pip, .appbar-desk, .appbar-bell { display: contents; }
  .context-pill { display: inline-flex; flex: none; align-items: center; gap: 6px; height: 26px; padding: 0 9px; border: 1px solid var(--line); border-radius: 999px; font-size: 11px; color: var(--fg-mut); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .context-pill:hover { color: var(--fg); }
  .context-pill__dot { width: 6px; height: 6px; border-radius: 999px; background: #5fae7e; }
  .context-pill[data-tone="warm"] .context-pill__dot { background: #d9a441; }
  .context-pill[data-tone="hot"] .context-pill__dot { background: #d45c5c; }
  .context-pill[data-tone="compacting"] .context-pill__dot { background: #d9a441; animation: context-pulse 1s ease-in-out infinite; }
  .context-pill__bar { display: none; width: 28px; height: 3px; border-radius: 2px; background: var(--color-surface-1); overflow: hidden; }
  .context-pill__bar > span { display: block; height: 100%; background: currentColor; opacity: 0.55; }
  @media (min-width: 640px) { .context-pill__bar { display: inline-block; } }
  @media (max-width: 559px) {
    .context-pill { display: none; }
    .safe-area-appbar { gap: 4px; padding-inline: 8px; }
    .safe-area-appbar :global(.nav-icon-button),
    .safe-area-appbar :global([data-attention-button]),
    .safe-area-appbar :global([aria-label="Open desk"]),
    .safe-area-appbar :global(.appbar-bell > *) { width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; }
  }
  @media (max-width: 359px) {
    .appbar-pip, .appbar-desk, .appbar-session-id { display: none; }
    .safe-area-appbar { min-height: 44px; padding: 4px 6px; gap: 3px; }
    .safe-area-appbar :global(.nav-icon-button),
    .safe-area-appbar :global([data-attention-button]),
    .safe-area-appbar :global(.appbar-bell > *) { width: 30px; height: 30px; }
  }
  @media (max-width: 260px), (max-height: 260px) {
    .appbar-signal, .appbar-voice, .appbar-pip, .appbar-desk, .appbar-bell, .appbar-session-id, .context-pill { display: none; }
    .safe-area-appbar { min-height: 34px; padding: 2px 4px; gap: 2px; }
    .safe-area-appbar :global(.nav-icon-button) { width: 26px; height: 26px; }
    .safe-area-appbar :global(.nav-icon-button svg) { width: 15px; height: 15px; }
  }
  @keyframes context-pulse { 50% { opacity: 0.25; } }
</style>
