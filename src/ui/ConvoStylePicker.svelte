<script lang="ts">
  import { onMount } from "svelte";
  import { CONVO_STYLES, CONVO_STYLE_SPECS, DEFAULT_CONVO_STYLE, convoStyleOf, type ConvoStyle } from "../convo-style";

  let { getSessionId, onStyle }: { getSessionId: () => string; onStyle?: (style: ConvoStyle) => void } = $props();

  let open = $state(false);
  let style = $state<ConvoStyle>(DEFAULT_CONVO_STYLE);
  let saving = $state(false);
  let error = $state("");
  let loadedFor = "";

  const validId = (id: string) => Boolean(id) && id !== "unknown" && id !== "new";

  async function load(force = false) {
    const id = getSessionId();
    if (!validId(id)) { style = DEFAULT_CONVO_STYLE; loadedFor = ""; return; }
    if (!force && id === loadedFor) return;
    loadedFor = id;
    const response = await fetch(`/api/sessions/${encodeURIComponent(id)}/convo-style`, { credentials: "include" }).catch(() => null);
    const body = response?.ok ? await response.json().catch(() => null) : null;
    if (getSessionId() === id) style = convoStyleOf(body?.result?.style);
  }

  async function choose(next: ConvoStyle) {
    const id = getSessionId();
    if (!validId(id)) { error = "Send a message first, then pick a style."; return; }
    const previous = style;
    style = next;
    saving = true;
    error = "";
    const response = await fetch(`/api/sessions/${encodeURIComponent(id)}/convo-style`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ style: next }),
    }).catch(() => null);
    saving = false;
    if (!response?.ok) { style = previous; error = "Could not save the style. Try again."; return; }
    open = false;
  }

  function toggle() {
    open = !open;
    error = "";
    if (open) void load(true);
  }

  function onKeydown(event: KeyboardEvent) {
    if (open && event.key === "Escape") open = false;
  }

  onMount(() => {
    void load(true);
    const timer = setInterval(() => void load(), 1500);
    const refresh = () => void load(true);
    window.addEventListener("my-ax:sessions-refresh", refresh);
    return () => { clearInterval(timer); window.removeEventListener("my-ax:sessions-refresh", refresh); };
  });

  const current = $derived(CONVO_STYLE_SPECS[style]);
  $effect(() => {
    onStyle?.(style);
  });
</script>

<svelte:window onkeydown={onKeydown} />

<div class="relative flex-none" data-convo-style-picker="1">
  {#if open}
    <button type="button" class="fixed inset-0 z-10 cursor-default" aria-label="Close conversation style" onclick={() => (open = false)}></button>
    <div
      class="absolute bottom-full right-0 z-20 mb-2 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-lg ring ring-line bg-bg shadow-lg"
      role="menu"
      aria-label="Conversation style"
      data-convo-style-menu="1"
    >
      <div class="px-3 pt-3 pb-2">
        <div class="text-sm font-semibold text-fg">Convo style</div>
        <div class="text-xs text-fg-mut">How the agent talks to you here. Applies to text and voice.</div>
      </div>
      {#each CONVO_STYLES as id (id)}
        {@const spec = CONVO_STYLE_SPECS[id]}
        <button
          type="button"
          role="menuitemradio"
          aria-checked={style === id}
          disabled={saving}
          data-convo-style-option={id}
          onclick={() => choose(id)}
          class="flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-bg-alt disabled:opacity-60"
        >
          <span class="mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full border {style === id ? 'border-brand bg-brand' : 'border-line'}" aria-hidden="true">
            {#if style === id}<span class="h-1.5 w-1.5 rounded-full bg-white"></span>{/if}
          </span>
          <span class="min-w-0">
            <span class="block text-sm text-fg {style === id ? 'font-semibold' : ''}">{spec.label}</span>
            <span class="block text-xs text-fg-mut">{spec.summary}</span>
          </span>
        </button>
      {/each}
      {#if error}<div class="px-3 pb-3 text-xs text-red-500" role="alert">{error}</div>{/if}
    </div>
  {/if}
  <button
    type="button"
    onclick={toggle}
    class="relative flex items-center justify-center rounded-lg w-11 h-11 border border-line bg-bg text-fg hover:border-brand/60 data-[open='1']:border-brand/60 data-[open='1']:text-brand"
    data-open={open ? "1" : "0"}
    data-convo-style-button={style}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label={`Convo style: ${current.label}`}
    title={`Convo style: ${current.label}`}
  >
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /><line x1="8" y1="9" x2="16" y2="9" /><line x1="8" y1="13" x2="12" y2="13" />
    </svg>
    {#if style !== DEFAULT_CONVO_STYLE}<span class="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-brand" aria-hidden="true"></span>{/if}
  </button>
</div>
