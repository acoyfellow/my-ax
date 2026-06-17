<script lang="ts">
  import { onMount } from "svelte";
  import { parseMyAxDeepLink } from "./deep-links";

  interface Item {
    id: string;
    title: string;
    body: string;
    href: string;
    created_at: string;
    seen_at: string | null;
  }

  let open = $state(false);
  let unread = $state(0);
  let items = $state<Item[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);

  function updateBadge() {
    if (unread > 0) void (navigator as any).setAppBadge?.(unread).catch?.(() => {});
    else void (navigator as any).clearAppBadge?.().catch?.(() => {});
  }
  async function refresh() {
    try {
      const r = await fetch("/api/attention", { credentials: "include" });
      if (!r.ok) throw new Error("Attention unavailable");
      const body = await r.json();
      unread = Number(body?.result?.unread ?? 0);
      items = body?.result?.items ?? [];
      error = null;
      updateBadge();
    } catch (err: any) {
      error = err?.message || "Attention unavailable";
    }
  }
  async function markSeen() {
    const ids = items.filter((item) => !item.seen_at).map((item) => item.id);
    if (!ids.length) return;
    await fetch("/api/attention/seen", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    unread = 0;
    items = items.map((item) => ({ ...item, seen_at: item.seen_at ?? new Date().toISOString() }));
    updateBadge();
  }
  async function openPanel() {
    open = true;
    loading = true;
    await refresh();
    loading = false;
    await markSeen();
  }
  async function toggle() {
    if (open) {
      open = false;
    } else {
      await openPanel();
    }
  }
  function age(value: string) {
    const ms = Date.now() - new Date(value.replace(" ", "T") + (value.includes("Z") ? "" : "Z")).getTime();
    if (!Number.isFinite(ms) || ms < 60_000) return "now";
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
    return `${Math.floor(ms / 86_400_000)}d`;
  }
  function closeOutside(event: PointerEvent) {
    if (!(event.target as Element)?.closest?.("[data-attention-root]")) open = false;
  }
  function follow(event: MouseEvent, href: string) {
    const target = parseMyAxDeepLink(href, location.href);
    if (!target) return;
    event.preventDefault();
    open = false;
    window.dispatchEvent(new CustomEvent("my-ax:navigate", { detail: target }));
  }
  onMount(() => {
    void refresh();
    const refreshVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const refreshMessage = (event: MessageEvent) => { if (event.data?.type === "my-ax:attention") void refresh(); };
    document.addEventListener("visibilitychange", refreshVisible);
    document.addEventListener("pointerdown", closeOutside);
    const openFromLaunch = () => { void openPanel(); };
    navigator.serviceWorker?.addEventListener("message", refreshMessage);
    window.addEventListener("my-ax:attention-open", openFromLaunch);
    return () => {
      document.removeEventListener("visibilitychange", refreshVisible);
      document.removeEventListener("pointerdown", closeOutside);
      navigator.serviceWorker?.removeEventListener("message", refreshMessage);
      window.removeEventListener("my-ax:attention-open", openFromLaunch);
    };
  });
</script>

<div class="relative flex-shrink-0" data-attention-root>
  <button type="button" onclick={toggle} class="relative flex items-center justify-center w-8 h-8 rounded-md text-fg-mut hover:text-fg hover:bg-surface-2 active:bg-surface-3 transition-colors" aria-label={unread ? `${unread} unread attention items` : "Attention"} aria-haspopup="dialog" aria-expanded={open} title="Attention">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
    {#if unread > 0}<span class="absolute top-0.5 right-0.5 min-w-3 h-3 px-0.5 rounded-full bg-brand text-white text-[8px] leading-3 text-center">{unread > 9 ? "9+" : unread}</span>{/if}
  </button>
  {#if open}
    <section class="absolute z-50 right-0 top-10 w-[min(22rem,calc(100vw-1rem))] max-h-[22rem] overflow-auto rounded-xl border border-line bg-bg-alt shadow-xl p-2" role="dialog" aria-label="Attention">
      <div class="flex items-center justify-between px-2 py-1.5"><h2 class="text-xs font-semibold text-fg">Attention</h2><span class="text-[10px] text-fg-mut">recent</span></div>
      {#if loading}<p class="px-2 py-3 text-xs text-fg-mut">Loading…</p>
      {:else if error}<p class="px-2 py-3 text-xs text-bad">{error}</p>
      {:else if items.length === 0}<p class="px-2 py-3 text-xs text-fg-mut">Nothing needs you.</p>
      {:else}
        <ul class="space-y-1">
          {#each items as item (item.id)}
            <li><a href={item.href} onclick={(event) => follow(event, item.href)} class="block rounded-lg px-2 py-2 hover:bg-surface-2"><span class="flex gap-2 justify-between"><strong class="text-xs font-medium text-fg">{item.title}</strong><time class="text-[10px] text-fg-mut">{age(item.created_at)}</time></span><span class="mt-0.5 block text-[11px] leading-snug text-fg-mut">{item.body}</span></a></li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</div>
