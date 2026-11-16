<script lang="ts">
  import { onMount } from "svelte";
  import { CONVO_STYLE_SPECS, DEFAULT_CONVO_STYLE, PICKER_STYLES, convoStyleOf, type ConvoStyle } from "../convo-style";

  let { getSessionId }: { getSessionId: () => string } = $props();

  let open = $state(false);
  let style = $state<ConvoStyle>(DEFAULT_CONVO_STYLE);
  let saving = $state(false);
  let error = $state("");
  let loadedFor = "";

  const validId = (id: string) => Boolean(id) && id !== "unknown" && id !== "new";

  function announce(next: ConvoStyle) {
    window.dispatchEvent(new CustomEvent("my-ax:convo-style", { detail: { sessionId: getSessionId(), style: next } }));
  }

  async function load(force = false) {
    const id = getSessionId();
    if (!validId(id)) { style = DEFAULT_CONVO_STYLE; loadedFor = ""; announce(style); return; }
    if (!force && id === loadedFor) return;
    loadedFor = id;
    const response = await fetch(`/api/sessions/${encodeURIComponent(id)}/convo-style`, { credentials: "include" }).catch(() => null);
    const body = response?.ok ? await response.json().catch(() => null) : null;
    if (getSessionId() !== id) return;
    style = convoStyleOf(body?.result?.style);
    announce(style);
  }

  async function choose(next: ConvoStyle) {
    const id = getSessionId();
    if (!validId(id)) { error = "Send a message first."; return; }
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
    if (!response?.ok) { style = previous; error = "Could not save. Try again."; return; }
    announce(next);
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
</script>

<svelte:window onkeydown={onKeydown} />

<div class="relative flex-none" data-convo-style-picker="1">
  <button
    type="button"
    onclick={toggle}
    class="flex items-center gap-1 rounded-full border px-2.5 h-7 text-xs whitespace-nowrap max-w-[6.5rem] sm:max-w-none {style === DEFAULT_CONVO_STYLE ? 'border-line text-fg-mut hover:text-fg' : 'border-brand/40 bg-brand/10 text-brand'}"
    data-convo-style-button={style}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label={`Reply style: ${current.label}`}
    title="Reply style"
  >
    <span class="truncate">{current.label}</span>
    <svg class="flex-none" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
  </button>
  {#if open}
    <button type="button" class="fixed inset-0 z-40 cursor-default" aria-label="Close reply style" onclick={() => (open = false)}></button>
    <div
      class="fixed left-3 right-3 top-[calc(env(safe-area-inset-top)+56px)] z-50 overflow-hidden rounded-lg ring ring-line bg-bg shadow-lg sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[22rem]"
      role="menu"
      aria-label="Reply style"
      data-convo-style-menu="1"
    >
      <div class="px-3 pt-2.5 pb-1.5 text-xs text-fg-mut">While it works, in this chat</div>
      {#each PICKER_STYLES as id (id)}
        {@const spec = CONVO_STYLE_SPECS[id]}
        <button
          type="button"
          role="menuitemradio"
          aria-checked={style === id}
          disabled={saving}
          data-convo-style-option={id}
          onclick={() => choose(id)}
          class="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-bg-alt disabled:opacity-60 {style === id ? 'bg-brand/5' : ''}"
        >
          <span class="min-w-0 flex-1">
            <span class="block text-sm text-fg {style === id ? 'font-semibold' : ''}">{spec.label}</span>
            <span class="block text-xs text-fg-mut">{spec.summary}</span>
          </span>
          <span class="flex-none rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide bg-bg-alt text-fg-mut" data-convo-style-while={spec.midTurn} title={spec.midTurnHint}>{spec.whileWorking}</span>
        </button>
      {/each}
      <div class="border-t border-line px-3 py-2 text-[11px] text-fg-mut">Tandem is a test. A fast assistant answers you while the agent keeps working.</div>
      {#if error}<div class="px-3 pb-2.5 text-xs text-red-500" role="alert">{error}</div>{/if}
    </div>
  {/if}
</div>
