<script lang="ts">
  import { onMount, tick } from "svelte";
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

  interface RunItem {
    id: string;
    status: string;
    title?: string | null;
    task_summary?: string | null;
    updated_at?: string | null;
  }

  type SectionId = "now" | "receipts";

  let open = $state(false);
  let unread = $state(0);
  let items = $state<Item[]>([]);
  let loading = $state(false);
  let clearing = $state(false);
  let error = $state<string | null>(null);
  let failedRuns = $state<RunItem[]>([]);
  let failedRunsError = $state<string | null>(null);
  let activeSection = $state<SectionId>("now");
  let dialogEl: HTMLDialogElement | null = null;

  const sections: { id: SectionId; title: string; summary: string }[] = [
    { id: "now", title: "Now", summary: "What needs you" },
    { id: "receipts", title: "Receipts", summary: "Failed work and pings" },
  ];

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
  async function refreshFailedRuns() {
    try {
      const r = await fetch("/api/runs?status=failed&limit=8", { credentials: "include" });
      if (!r.ok) throw new Error("Failed runs unavailable");
      const body = await r.json();
      failedRuns = Array.isArray(body?.result?.runs) ? body.result.runs : [];
      failedRunsError = null;
    } catch (err: any) {
      failedRunsError = err?.message || "Failed runs unavailable";
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
  function closePanel() {
    open = false;
    if (dialogEl?.open) dialogEl.close();
  }
  async function openPanel() {
    open = true;
    await tick();
    if (dialogEl && !dialogEl.open) dialogEl.showModal();
    loading = true;
    await Promise.all([refresh(), refreshFailedRuns()]);
    loading = false;
    await markSeen();
  }
  async function toggle() {
    if (open) {
      closePanel();
    } else {
      await openPanel();
    }
  }
  function activateSection(section: SectionId) {
    activeSection = section;
  }
  function runTitle(run: RunItem) {
    return run.title || run.task_summary || run.id;
  }
  function runSummary(run: RunItem) {
    const title = run.title?.trim();
    const summary = run.task_summary?.trim();
    if (summary && summary !== title) return summary;
    return "Failed run receipt is ready for review.";
  }
  function age(value: string) {
    const ms = Date.now() - new Date(value.replace(" ", "T") + (value.includes("Z") ? "" : "Z")).getTime();
    if (!Number.isFinite(ms) || ms < 60_000) return "now";
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
    return `${Math.floor(ms / 86_400_000)}d`;
  }
  function isFailedRunsHref(href: string) {
    return href === "/runs?status=failed" || href === "/api/runs?status=failed" || href.startsWith("/runs?status=failed&") || href.startsWith("/api/runs?status=failed&");
  }
  function handlePanelClick(event: MouseEvent) {
    const link = (event.target as Element)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!link) return;
    const href = link.getAttribute("href") || "";
    if (!isFailedRunsHref(href)) return;
    event.preventDefault();
    activeSection = "receipts";
  }
  function runReceiptId(href: string): string | null {
    try {
      const url = new URL(href, location.origin);
      if (url.origin !== location.origin) return null;
      const match = /^\/runs\/([^/?#]+)$/.exec(url.pathname);
      return match ? decodeURIComponent(match[1]) : null;
    } catch {
      return null;
    }
  }
  function follow(event: MouseEvent, href: string) {
    if (isFailedRunsHref(href)) {
      event.preventDefault();
      activeSection = "receipts";
      return;
    }
    // A run receipt opens as a NESTED modal above this panel — do not close the
    // panel and do not fall through to a full-page navigation.
    const receipt = runReceiptId(href);
    if (receipt) {
      event.preventDefault();
      window.dispatchEvent(new CustomEvent("my-ax:run-receipt-open", { detail: { runId: receipt } }));
      return;
    }
    const target = parseMyAxDeepLink(href, location.href);
    if (!target) return;
    event.preventDefault();
    closePanel();
    window.dispatchEvent(new CustomEvent("my-ax:navigate", { detail: target }));
  }
  onMount(() => {
    void refresh();
    const refreshVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const refreshMessage = (event: MessageEvent) => { if (event.data?.type === "my-ax:attention") void refresh(); };
    document.addEventListener("visibilitychange", refreshVisible);
    const openFromLaunch = () => { void openPanel(); };
    navigator.serviceWorker?.addEventListener("message", refreshMessage);
    window.addEventListener("my-ax:attention-open", openFromLaunch);
    return () => {
      document.removeEventListener("visibilitychange", refreshVisible);
      navigator.serviceWorker?.removeEventListener("message", refreshMessage);
      window.removeEventListener("my-ax:attention-open", openFromLaunch);
    };
  });
</script>

<div class="relative h-10 w-10 flex-shrink-0" data-attention-root>
  <button type="button" onclick={toggle} class="relative flex items-center justify-center w-10 h-10 rounded-md text-fg-mut hover:text-fg hover:bg-surface-2 active:bg-surface-3 transition-colors" aria-label={unread ? `${unread} unread attention items` : "Attention"} aria-haspopup="dialog" aria-expanded={open} title="Attention">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
    {#if unread > 0}<span class="absolute top-0.5 right-0.5 min-w-3 h-3 px-0.5 rounded-full bg-brand text-white text-[8px] leading-3 text-center">{unread > 9 ? "9+" : unread}</span>{/if}
  </button>
  {#if open}
    <dialog
      bind:this={dialogEl}
      class="attention-owner-panel z-50 w-[min(760px,calc(100vw-1rem))] max-h-[min(760px,calc(100dvh-1rem))] overflow-hidden border border-line bg-bg-alt p-0 text-fg"
      aria-label="Attention and Check-in"
      onclick={(event) => event.target === event.currentTarget && closePanel()}
      oncancel={(event) => { event.preventDefault(); closePanel(); }}
      onclose={() => { if (open) closePanel(); }}
      data-attention-owner-panel
    >
      <div class="attention-owner-header safe-area-appbar">
        <div>
          <h2 class="text-sm font-semibold text-fg">Check-in</h2>
          <p class="text-[11px] text-fg-mut">What needs you, then receipts.</p>
        </div>
        <button type="button" onclick={closePanel} class="attention-owner-close" aria-label="Close Check-in panel">×</button>
      </div>
      <div class="attention-owner-layout grid flex-1 min-h-0 overflow-hidden">
        <nav aria-label="Check-in sections" class="attention-owner-nav flex gap-1 overflow-x-auto border-b border-line p-2 sm:flex-col sm:border-b-0 sm:border-r">
          {#each sections as section}
            <button
              type="button"
              onclick={() => activateSection(section.id)}
              aria-current={activeSection === section.id ? "page" : undefined}
              class:attention-owner-nav-active={activeSection === section.id}
              class="attention-owner-nav-item min-w-max px-3 py-2 text-left sm:min-w-0"
            >
              <span class="block text-sm font-semibold">{section.title}</span>
              <span class="mt-0.5 block text-[11px] leading-snug text-fg-mut">{section.summary}</span>
            </button>
          {/each}
        </nav>
        <div class="attention-owner-content min-h-0 max-h-full overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-width:thin] p-4 sm:p-5" onclick={handlePanelClick} data-attention-owner-content>
          {#if activeSection === "now"}
            <section class="attention-owner-section">
              <header class="attention-owner-section-header">
                <span class="attention-owner-eyebrow">Now</span>
                <h3 class="attention-owner-title">What needs you</h3>
                <p class="attention-owner-description">A single owner-return summary. The primary action stays here unless you open a specific source receipt.</p>
              </header>
              <div class="attention-owner-card overflow-hidden p-0">
                <CheckIn embedded />
              </div>
            </section>
          {:else}
            <section class="attention-owner-section">
              <header class="attention-owner-section-header">
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <span class="attention-owner-eyebrow">Receipts</span>
                    <h3 class="attention-owner-title">Failed work and recent pings</h3>
                    <p class="attention-owner-description">One receipt stream for work that wanted your attention. Failed runs are called out first; source receipts stay secondary.</p>
                  </div>
                  {#if items.length > 0}
                    <button type="button" onclick={clearAll} disabled={clearing} class="attention-owner-secondary-action">
                      {clearing ? "Clearing…" : "Clear all"}
                    </button>
                  {/if}
                </div>
              </header>

              <section class="attention-owner-subsection" aria-label="Failed run receipts">
                <h4 class="attention-owner-subtitle">Failed runs</h4>
                {#if loading}<p class="attention-owner-card attention-owner-muted">Loading failed runs…</p>
                {:else if failedRunsError}<p class="attention-owner-card text-bad">{failedRunsError}</p>
                {:else if failedRuns.length === 0}<p class="attention-owner-card attention-owner-muted">No failed runs need review.</p>
                {:else}
                  <ul class="grid gap-2">
                    {#each failedRuns as run (run.id)}
                      <li class="attention-owner-card">
                        <div class="flex items-start justify-between gap-3">
                          <div class="min-w-0">
                            <strong class="block truncate text-sm font-semibold text-fg">{runTitle(run)}</strong>
                            <p class="mt-1 line-clamp-2 text-xs leading-relaxed text-fg-mut">{runSummary(run)}</p>
                          </div>
                          <span class="attention-owner-status-bad">Failed</span>
                        </div>
                        <div class="mt-3 flex items-center justify-between gap-3">
                          <code class="min-w-0 truncate font-mono text-[10px] text-fg-mut">{run.id}</code>
                          <a href={`/runs/${run.id}`} class="shrink-0 text-xs font-semibold text-brand hover:underline" onclick={(event) => follow(event, `/runs/${run.id}`)}>Open source receipt</a>
                        </div>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </section>

              <section class="attention-owner-subsection" aria-label="Recent notifications">
                <h4 class="attention-owner-subtitle">Recent pings</h4>
                {#if loading}<p class="attention-owner-card attention-owner-muted">Loading notifications…</p>
                {:else if error}<p class="attention-owner-card text-bad">{error}</p>
                {:else if items.length === 0}<p class="attention-owner-card attention-owner-muted">No recent pings.</p>
                {:else}
                  <ul class="grid gap-2">
                    {#each items as item (item.id)}
                      <li class="attention-owner-card">
                        <a href={item.href} onclick={(event) => follow(event, item.href)} class="block">
                          <span class="flex gap-2 justify-between">
                            <strong class="min-w-0 truncate text-sm font-semibold text-fg">{item.title}</strong>
                            <time class="shrink-0 text-[10px] text-fg-mut">{age(item.created_at)}</time>
                          </span>
                          <span class="mt-1 block text-xs leading-relaxed text-fg-mut">{item.body}</span>
                        </a>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </section>
            </section>
          {/if}
        </div>
      </div>
    </dialog>
  {/if}
</div>

<style>
  .attention-owner-panel {
    position: fixed;
    inset: max(0.5rem, env(safe-area-inset-top)) auto auto 50%;
    height: min(760px, calc(100dvh - 1rem));
    margin: 0;
    transform: translateX(-50%);
    border-radius: 18px;
    box-shadow: 0 28px 80px rgb(0 0 0 / 0.32), 0 2px 10px rgb(0 0 0 / 0.12);
  }

  .attention-owner-panel[open] {
    display: flex;
    flex-direction: column;
  }

  .attention-owner-panel::backdrop {
    background: rgb(0 0 0 / 0.56);
    backdrop-filter: blur(3px);
  }

  .attention-owner-header {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 68px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--line);
    background: var(--bg-alt);
  }

  .attention-owner-close {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    min-height: 36px;
    padding: 0 11px;
    color: var(--fg-mut);
    border: 1px solid var(--line);
    border-radius: 7px;
    background: var(--bg);
    font-family: inherit;
    font-size: 12px;
    line-height: 1;
    box-shadow: 0 1px 1px rgb(0 0 0 / 0.05);
    transition: color 120ms, border-color 120ms, background 120ms;
  }

  .attention-owner-close:hover {
    color: var(--fg);
    border-color: color-mix(in srgb, var(--fg-mut) 55%, var(--line));
    background: var(--surface-2);
  }

  .attention-owner-layout {
    grid-template-rows: auto minmax(0, 1fr);
    background: var(--bg-alt);
  }

  .attention-owner-nav {
    background: color-mix(in srgb, var(--bg) 68%, var(--bg-alt));
    scrollbar-width: none;
  }

  .attention-owner-nav::-webkit-scrollbar { display: none; }

  .attention-owner-nav-item {
    position: relative;
    color: var(--fg-mut);
    border: 1px solid transparent;
    border-radius: 9px;
    transition: color 120ms, border-color 120ms, background 120ms, box-shadow 120ms;
  }

  .attention-owner-nav-item:hover {
    color: var(--fg);
    background: color-mix(in srgb, var(--surface-2) 70%, transparent);
  }

  .attention-owner-nav-item.attention-owner-nav-active {
    color: var(--fg);
    border-color: var(--line);
    background: var(--bg-alt);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.06);
  }

  .attention-owner-nav-item.attention-owner-nav-active::before {
    content: "";
    position: absolute;
    top: 9px;
    bottom: 9px;
    left: -1px;
    width: 2px;
    border-radius: 2px;
    background: var(--brand);
  }

  .attention-owner-content {
    background: var(--bg-alt);
    scrollbar-gutter: stable;
  }

  .attention-owner-section {
    display: grid;
    gap: 0.875rem;
  }

  .attention-owner-subsection {
    display: grid;
    gap: 0.5rem;
  }

  .attention-owner-subtitle {
    color: var(--fg);
    font-size: 12px;
    font-weight: 650;
  }

  .attention-owner-section-header {
    display: grid;
    gap: 0.25rem;
  }

  .attention-owner-eyebrow {
    color: var(--fg-mut);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .attention-owner-title {
    color: var(--fg);
    font-size: 14px;
    font-weight: 650;
    line-height: 1.25;
  }

  .attention-owner-description {
    max-width: 58ch;
    color: var(--fg-mut);
    font-size: 12px;
    line-height: 1.6;
  }

  .attention-owner-card {
    border: 1px solid var(--line);
    border-radius: 0.5rem;
    background: var(--bg);
    padding: 0.75rem;
    color: var(--fg);
    font-size: 0.875rem;
    line-height: 1.45;
  }

  .attention-owner-muted {
    color: var(--fg-mut);
    font-size: 0.875rem;
  }

  .attention-owner-status-bad {
    flex: none;
    border: 1px solid color-mix(in srgb, var(--bad) 32%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--bad) 10%, transparent);
    color: var(--bad);
    padding: 0.125rem 0.5rem;
    font-size: 10px;
    font-weight: 700;
    line-height: 1rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .attention-owner-secondary-action {
    flex: none;
    border: 1px solid var(--line);
    border-radius: 0.375rem;
    color: var(--fg-mut);
    padding: 0.375rem 0.625rem;
    font-size: 0.75rem;
    font-weight: 500;
    transition: color 120ms, background 120ms;
  }

  .attention-owner-secondary-action:hover {
    color: var(--fg);
    background: var(--surface-2);
  }

  @media (min-width: 640px) {
    .attention-owner-panel { top: 6vh; }
    .attention-owner-layout {
      grid-template-columns: 190px minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr);
    }
  }

  @media (max-width: 639px) {
    .attention-owner-panel {
      width: calc(100vw - 1rem);
      height: calc(100dvh - max(1rem, env(safe-area-inset-top) + env(safe-area-inset-bottom)));
      max-height: calc(100dvh - max(1rem, env(safe-area-inset-top) + env(safe-area-inset-bottom)));
      border-radius: 14px;
    }
    .attention-owner-header { min-height: 60px; padding: 9px; gap: 8px; }
    .attention-owner-close { min-height: 40px; }
    .attention-owner-nav-item.attention-owner-nav-active::before { display: none; }
  }
</style>

