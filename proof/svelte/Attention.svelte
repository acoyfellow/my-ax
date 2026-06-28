<script lang="ts">
  import { onMount } from "svelte";
  import { parseMyAxDeepLink } from "./deep-links";
  import { reconcileSeen } from "./attention-state";
  import CheckIn from "./CheckIn.svelte";

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
  let clearing = $state(false);
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
    try {
      const response = await fetch("/api/attention/seen", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!response.ok) throw new Error("Could not mark attention as seen");
      const body = await response.json();
      const serverUnread = Number(body?.result?.unread);
      if (!Number.isFinite(serverUnread)) throw new Error("Could not reconcile attention state");
      const reconciled = reconcileSeen(items, serverUnread, ids, new Date().toISOString());
      unread = reconciled.unread;
      items = reconciled.items;
      error = null;
      updateBadge();
    } catch (err: any) {
      error = err?.message || "Could not mark attention as seen";
    }
  }
  async function clearAll() {
    if (!items.length || clearing) return;
    if (!window.confirm(`Clear all ${items.length} recent Attention items? This removes notification receipts, not their source conversations or jobs.`)) return;
    clearing = true;
    try {
      const response = await fetch("/api/attention", { method: "DELETE", credentials: "include" });
      if (!response.ok) throw new Error("Could not clear Attention");
      const body = await response.json();
      const serverItems = body?.result?.items;
      const serverUnread = Number(body?.result?.unread);
      if (!Array.isArray(serverItems) || !Number.isFinite(serverUnread)) throw new Error("Could not reconcile Attention state");
      items = serverItems;
      unread = serverUnread;
      error = null;
      updateBadge();
    } catch (err: any) {
      error = err?.message || "Could not clear Attention";
    } finally {
      clearing = false;
    }
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

<div class="relative h-8 w-8 flex-shrink-0" data-attention-root>
  <button type="button" onclick={toggle} class="relative flex items-center justify-center w-8 h-8 rounded-md text-fg-mut hover:text-fg hover:bg-surface-2 active:bg-surface-3 transition-colors" aria-label={unread ? `${unread} unread attention items` : "Attention"} aria-haspopup="dialog" aria-expanded={open} title="Attention">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
    {#if unread > 0}<span class="absolute top-0.5 right-0.5 min-w-3 h-3 px-0.5 rounded-full bg-brand text-white text-[8px] leading-3 text-center">{unread > 9 ? "9+" : unread}</span>{/if}
  </button>
  {#if open}
    <button type="button" class="fixed inset-0 z-40 bg-black/55 backdrop-blur-[3px]" aria-label="Close Check-in panel backdrop" onclick={() => open = false} data-attention-owner-backdrop></button>
    <section class="attention-owner-panel fixed left-1/2 top-2 z-50 flex h-[min(760px,calc(100dvh-1rem))] max-h-[min(760px,calc(100dvh-1rem))] w-[min(760px,calc(100vw-1rem))] -translate-x-1/2 flex-col overflow-hidden rounded-[18px] border border-line bg-bg-alt text-fg shadow-[0_28px_80px_rgb(0_0_0/0.32),0_2px_10px_rgb(0_0_0/0.12)] sm:top-[6vh] max-sm:h-[calc(100dvh-1rem)] max-sm:max-h-[calc(100dvh-1rem)] max-sm:rounded-[14px]" role="dialog" aria-label="Attention and Check-in" data-attention-owner-panel>
      <div class="flex items-center justify-between gap-3 border-b border-line bg-bg px-4 py-3">
        <div>
          <h2 class="text-sm font-semibold text-fg">Check-in</h2>
          <p class="text-[11px] text-fg-mut">What needs you, then receipts.</p>
        </div>
        <button type="button" onclick={() => open = false} class="flex h-8 w-8 items-center justify-center rounded-md text-fg-mut hover:bg-surface-2 hover:text-fg" aria-label="Close Check-in panel">×</button>
      </div>
      <div class="min-h-0 flex-1 overflow-auto">
        <div class="border-b border-line bg-bg">
          <CheckIn />
        </div>
        <div class="flex items-center justify-between gap-3 px-4 py-3">
          <h3 class="text-xs font-semibold text-fg">Notifications</h3>
        {#if items.length > 0}
          <button type="button" onclick={clearAll} disabled={clearing} class="rounded px-1.5 py-1 text-[10px] font-medium text-fg-mut hover:bg-surface-2 hover:text-fg disabled:opacity-50">
            {clearing ? "Clearing…" : "Clear all"}
          </button>
        {:else}
          <span class="text-[10px] text-fg-mut">recent</span>
        {/if}
      </div>
        {#if loading}<p class="px-4 py-3 text-xs text-fg-mut">Loading…</p>
        {:else if error}<p class="px-4 py-3 text-xs text-bad">{error}</p>
        {:else if items.length === 0}<p class="px-4 pb-4 text-sm text-fg-mut">Nothing needs you.</p>
        {:else}
          <ul class="space-y-1 px-2 pb-3">
            {#each items as item (item.id)}
              <li><a href={item.href} onclick={(event) => follow(event, item.href)} class="block rounded-lg px-2 py-2 hover:bg-surface-2"><span class="flex gap-2 justify-between"><strong class="text-xs font-medium text-fg">{item.title}</strong><time class="text-[10px] text-fg-mut">{age(item.created_at)}</time></span><span class="mt-0.5 block text-[11px] leading-snug text-fg-mut">{item.body}</span></a></li>
            {/each}
          </ul>
        {/if}
      </div>
    </section>
  {/if}
</div>

