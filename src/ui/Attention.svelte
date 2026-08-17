<script lang="ts">
  import { onMount, tick } from "svelte";
  import { parseMyAxDeepLink } from "./deep-links";
  import { attentionSourceLabel, isExternalSourceHref } from "../source-href";
  import { reconcileSeen } from "./attention-state";
  import {
    buildNotificationStream,
    unreadCount,
    type AttentionItem,
    type FailedRun,
    type Notification,
  } from "./notification-stream";

  let open = $state(false);
  let unread = $state(0);
  let items = $state<AttentionItem[]>([]);
  let failedRuns = $state<FailedRun[]>([]);
  let dismissedRuns = $state<Set<string>>(new Set());
  let loading = $state(false);
  let clearing = $state(false);
  let error = $state<string | null>(null);
  let selectedId = $state<string | null>(null);
  let dialogEl: HTMLDialogElement | null = null;

  // The single unified, reverse-chronological stream (attention pings + failed
  // runs), with owner-dismissed runs filtered out. See notification-stream.ts.
  const stream = $derived(buildNotificationStream(items, failedRuns, dismissedRuns));
  const selected = $derived(stream.find((note) => note.id === selectedId) ?? null);

  function updateBadge() {
    if (unread > 0) void (navigator as any).setAppBadge?.(unread).catch?.(() => {});
    else void (navigator as any).clearAppBadge?.().catch?.(() => {});
  }
  async function refresh() {
    try {
      const r = await fetch("/api/attention", { credentials: "include" });
      if (!r.ok) throw new Error("Notifications unavailable");
      const body = await r.json();
      unread = Number(body?.result?.unread ?? 0);
      items = body?.result?.items ?? [];
      error = null;
      updateBadge();
    } catch (err: any) {
      error = err?.message || "Notifications unavailable";
    }
  }
  async function refreshFailedRuns() {
    try {
      const r = await fetch("/api/runs?status=failed&limit=8", { credentials: "include" });
      if (!r.ok) throw new Error("Failed runs unavailable");
      const body = await r.json();
      failedRuns = Array.isArray(body?.result?.runs) ? body.result.runs : [];
    } catch {
      // A failed-runs fetch error is non-fatal for the stream; pings still show.
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
      if (!response.ok) throw new Error("Could not mark notifications as seen");
      const body = await response.json();
      const serverUnread = Number(body?.result?.unread);
      if (!Number.isFinite(serverUnread)) throw new Error("Could not reconcile notification state");
      const reconciled = reconcileSeen(items as any, serverUnread, ids, new Date().toISOString());
      unread = reconciled.unread;
      items = reconciled.items as any;
      error = null;
      updateBadge();
    } catch (err: any) {
      error = err?.message || "Could not mark notifications as seen";
    }
  }
  async function clearAll() {
    if (!stream.length || clearing) return;
    if (!window.confirm("Clear all notifications? This removes the notification entries (including failed-run alerts), not the source conversations or runs.")) return;
    clearing = true;
    try {
      // Clear attention pings and dismiss listed failed runs together.
      const hasRuns = failedRuns.some((run) => !dismissedRuns.has(`run:${run.id}`));
      const requests: Promise<Response>[] = [fetch("/api/attention", { method: "DELETE", credentials: "include" })];
      if (hasRuns) requests.push(fetch("/api/runs/dismiss-all", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "failed" }) }));
      const [attnRes] = await Promise.all(requests);
      if (!attnRes.ok) throw new Error("Could not clear notifications");
      const body = await attnRes.json();
      const serverItems = body?.result?.items;
      const serverUnread = Number(body?.result?.unread);
      if (!Array.isArray(serverItems) || !Number.isFinite(serverUnread)) throw new Error("Could not reconcile notification state");
      items = serverItems;
      unread = serverUnread;
      failedRuns = [];
      dismissedRuns = new Set();
      error = null;
      updateBadge();
    } catch (err: any) {
      error = err?.message || "Could not clear notifications";
    } finally {
      clearing = false;
    }
  }
  async function dismiss(event: MouseEvent, note: Notification) {
    event.preventDefault();
    event.stopPropagation();
    if (note.source === "run") {
      const runId = note.id.slice("run:".length);
      // Optimistic removal, then persist.
      dismissedRuns = new Set([...dismissedRuns, note.id]);
      try {
        const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/dismiss`, { method: "POST", credentials: "include" });
        if (!res.ok) throw new Error("dismiss failed");
      } catch {
        // Roll back on failure so the item reappears rather than silently vanish.
        const next = new Set(dismissedRuns);
        next.delete(note.id);
        dismissedRuns = next;
        error = "Could not dismiss that failed run.";
      }
    } else {
      // Attention pings clear as a group today (no per-item DELETE endpoint);
      // dismissing one marks it seen so it stops counting toward unread.
      items = items.map((item) => (item.id === note.id ? { ...item, seen_at: item.seen_at ?? new Date().toISOString() } : item));
      const target = items.find((item) => item.id === note.id);
      if (target) void markSeenOne(note.id);
    }
  }
  async function markSeenOne(id: string) {
    try {
      const response = await fetch("/api/attention/seen", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [id] }) });
      if (response.ok) {
        const body = await response.json();
        const serverUnread = Number(body?.result?.unread);
        if (Number.isFinite(serverUnread)) { unread = serverUnread; updateBadge(); }
      }
    } catch {}
  }
  function replaceAttentionUrl(attentionId: string | null, keepPanel: boolean) {
    const url = new URL(location.href);
    if (keepPanel) url.searchParams.set("action", "attention");
    else if (url.searchParams.get("action") === "attention") url.searchParams.delete("action");
    if (attentionId) url.searchParams.set("attentionId", attentionId);
    else url.searchParams.delete("attentionId");
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }
  async function ensureItem(id: string) {
    if (stream.some((note) => note.id === id) || id.startsWith("run:")) return;
    const response = await fetch(`/api/attention/${encodeURIComponent(id)}`, { credentials: "include" });
    if (!response.ok) throw new Error("That notification is no longer available");
    const body = await response.json();
    const item = body?.result?.item;
    if (!item?.id) throw new Error("That notification is no longer available");
    items = [item, ...items.filter((candidate) => candidate.id !== item.id)];
  }
  function closePanel() {
    open = false;
    selectedId = null;
    replaceAttentionUrl(null, false);
    if (dialogEl?.open) dialogEl.close();
  }
  async function openPanel(attentionId: string | null = null) {
    selectedId = attentionId;
    if (attentionId) replaceAttentionUrl(attentionId, true);
    open = true;
    await tick();
    if (dialogEl && !dialogEl.open) dialogEl.showModal();
    loading = true;
    await Promise.all([refresh(), refreshFailedRuns()]);
    if (attentionId) {
      try {
        await ensureItem(attentionId);
        await markSeenOne(attentionId);
      } catch (err: any) {
        error = err?.message || "That notification is no longer available";
      }
    }
    loading = false;
    if (!attentionId) await markSeen();
  }
  async function toggle() {
    if (open) closePanel();
    else await openPanel();
  }
  function showDetail(event: MouseEvent, note: Notification) {
    event.preventDefault();
    selectedId = note.id;
    replaceAttentionUrl(note.source === "attention" ? note.id : null, true);
    if (note.source === "attention") void markSeenOne(note.id);
  }
  function showList() {
    selectedId = null;
    replaceAttentionUrl(null, true);
  }
  function sourceLabel(href: string | null) {
    return attentionSourceLabel(href, location.href);
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
  // Secondary action: open the run receipt / artifact as a nested modal.
  function openWidget(event: MouseEvent, href: string) {
    event.preventDefault();
    event.stopPropagation();
    const receipt = runReceiptId(href);
    if (receipt) {
      window.dispatchEvent(new CustomEvent("my-ax:run-receipt-open", { detail: { runId: receipt } }));
      return;
    }
    follow(event, href);
  }
  // Primary action: go to the conversation (or the deep-link target).
  function follow(event: MouseEvent, href: string | null) {
    if (!href) return;
    event.preventDefault();
    if (isExternalSourceHref(href)) {
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    const receipt = runReceiptId(href);
    if (receipt) {
      window.dispatchEvent(new CustomEvent("my-ax:run-receipt-open", { detail: { runId: receipt } }));
      return;
    }
    const target = parseMyAxDeepLink(href, location.href);
    if (!target) return;
    closePanel();
    window.dispatchEvent(new CustomEvent("my-ax:navigate", { detail: target }));
  }
  function age(ts: number) {
    const ms = Date.now() - ts;
    if (!Number.isFinite(ms) || ms < 60_000) return "now";
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
    return `${Math.floor(ms / 86_400_000)}d`;
  }
  onMount(() => {
    void refresh();
    const refreshVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const refreshMessage = (event: MessageEvent) => { if (event.data?.type === "my-ax:attention") void refresh(); };
    document.addEventListener("visibilitychange", refreshVisible);
    const openFromLaunch = (event: Event) => {
      const attentionId = (event as CustomEvent<{ attentionId?: string | null }>).detail?.attentionId ?? null;
      void openPanel(attentionId);
    };
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
  <button type="button" onclick={toggle} class="relative flex items-center justify-center w-10 h-10 rounded-md text-fg-mut hover:text-fg hover:bg-surface-2 active:bg-surface-3 transition-colors" aria-label={unread ? `${unread} unread notifications` : "Notifications"} aria-haspopup="dialog" aria-expanded={open} title="Notifications">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
    {#if unread > 0}<span class="absolute top-0.5 right-0.5 min-w-3 h-3 px-0.5 rounded-full bg-brand text-white text-[8px] leading-3 text-center">{unread > 9 ? "9+" : unread}</span>{/if}
  </button>
  {#if open}
    <dialog
      bind:this={dialogEl}
      class="notif-panel z-50 overflow-hidden border border-line bg-bg-alt p-0 text-fg"
      aria-label="Notifications"
      onclick={(event) => event.target === event.currentTarget && closePanel()}
      oncancel={(event) => { event.preventDefault(); closePanel(); }}
      onclose={() => { if (open) closePanel(); }}
      data-attention-owner-panel
    >
      <div class="notif-header safe-area-appbar">
        <div class="flex min-w-0 items-center gap-2">
          {#if selectedId}
            <button type="button" onclick={showList} class="notif-close" aria-label="Back to notifications">←</button>
          {/if}
          <h2 class="truncate text-sm font-semibold text-fg">{selectedId ? "Notification" : "Notifications"}</h2>
        </div>
        <div class="flex items-center gap-1">
          {#if !selectedId && stream.length > 0}
            <button type="button" onclick={clearAll} disabled={clearing} class="notif-clear-all">{clearing ? "Clearing…" : "Clear all"}</button>
          {/if}
          <button type="button" onclick={closePanel} class="notif-close" aria-label="Close notifications">×</button>
        </div>
      </div>
      <div class="notif-body" data-attention-owner-content>
        {#if selected}
          <article class="notif-detail" data-notification-detail={selected.id}>
            <div class="flex items-center gap-2">
              <span class="notif-pill" data-tone={selected.tone}>{selected.label}</span>
              <time class="notif-detail-time">{new Date(selected.ts).toLocaleString()}</time>
            </div>
            <h3 class="notif-detail-title">{selected.title}</h3>
            {#if selected.body}<p class="notif-detail-body">{selected.body}</p>{/if}
            {#if selected.decisionHref}
              <a class="notif-detail-source" href={selected.decisionHref}>Decide</a>
            {:else if sourceLabel(selected.href)}
              <button type="button" class="notif-detail-source" onclick={(event) => follow(event, selected.href)}>{sourceLabel(selected.href)}</button>
            {/if}
          </article>
        {:else if selectedId && loading}
          <p class="notif-empty">Loading notification…</p>
        {:else if selectedId}
          <p class="notif-empty text-bad">{error ?? "That notification is no longer available"}</p>
        {:else if loading && stream.length === 0}
          <p class="notif-empty">Loading…</p>
        {:else if error && stream.length === 0}
          <p class="notif-empty text-bad">{error}</p>
        {:else if stream.length === 0}
          <p class="notif-empty">You're all caught up.</p>
        {:else}
          <ul class="notif-list">
            {#each stream as note (note.id)}
              <li class="notif-item" data-tone={note.tone} data-unread={note.unread ? "1" : undefined}>
                <a class="notif-item-main" href={note.source === "attention" ? `/?action=attention&attentionId=${encodeURIComponent(note.id)}` : "#"} onclick={(event) => showDetail(event, note)}>
                  <span class="notif-row">
                    <span class="notif-pill" data-tone={note.tone}>{note.label}</span>
                    <strong class="notif-title">{note.title}</strong>
                    <time class="notif-time">{age(note.ts)}</time>
                  </span>
                  {#if note.body}<span class="notif-body-text">{note.body}</span>{/if}
                </a>
                <div class="notif-actions">
                  {#if note.widgetHref}
                    <button type="button" class="notif-action" onclick={(event) => openWidget(event, note.widgetHref!)}>View</button>
                  {/if}
                  <button type="button" class="notif-dismiss" aria-label="Dismiss notification" title="Dismiss" onclick={(event) => dismiss(event, note)}>×</button>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </dialog>
  {/if}
</div>

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
  .notif-clear-all {
    border: 1px solid var(--line);
    border-radius: 0.375rem;
    color: var(--fg-mut);
    padding: 0.3rem 0.55rem;
    font-size: 0.75rem;
    transition: color 120ms, background 120ms;
  }
  .notif-clear-all:hover { color: var(--fg); background: var(--surface-2); }
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
  .notif-item[data-unread="1"]::before {
    content: "";
    position: absolute;
    left: 4px;
    top: 16px;
    width: 5px;
    height: 5px;
    border-radius: 999px;
    background: var(--brand);
  }
  .notif-item-main { display: block; min-width: 0; flex: 1; }
  .notif-row { display: flex; align-items: center; gap: 7px; }
  .notif-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.85rem; font-weight: 600; color: var(--fg); }
  .notif-time { flex: none; margin-left: auto; font-size: 10px; color: var(--fg-mut); }
  .notif-body-text {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    margin-top: 2px;
    font-size: 0.78rem;
    line-height: 1.45;
    color: var(--fg-mut);
  }
  .notif-detail {
    display: flex;
    min-height: 280px;
    flex-direction: column;
    align-items: flex-start;
    padding: 22px;
  }
  .notif-detail-time { font-size: 11px; color: var(--fg-mut); }
  .notif-detail-title {
    margin-top: 18px;
    font-size: 1.15rem;
    font-weight: 700;
    line-height: 1.35;
    color: var(--fg);
  }
  .notif-detail-body {
    margin-top: 12px;
    white-space: pre-wrap;
    font-size: 0.95rem;
    line-height: 1.65;
    color: var(--fg);
  }
  .notif-detail-source {
    margin-top: 24px;
    border-radius: 0.5rem;
    background: var(--brand);
    padding: 0.6rem 0.85rem;
    font-size: 0.8rem;
    font-weight: 700;
    color: white;
  }
  .notif-detail-source:hover { opacity: 0.9; }
  .notif-actions { display: flex; flex: none; align-items: center; gap: 4px; }
  .notif-action {
    border: 1px solid var(--line);
    border-radius: 0.375rem;
    color: var(--fg-mut);
    padding: 0.25rem 0.5rem;
    font-size: 0.72rem;
    font-weight: 600;
  }
  .notif-action:hover { color: var(--fg); background: var(--surface-2); }
  .notif-dismiss {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 28px;
    min-height: 28px;
    color: var(--fg-mut);
    border-radius: 6px;
    font-size: 14px;
    line-height: 1;
  }
  .notif-dismiss:hover { color: var(--fg); background: var(--surface-2); }

  /* Type pill — colour by tone. */
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
  .notif-pill[data-tone="retrying"] { border-color: color-mix(in srgb, #f59e0b 45%, var(--line)); color: #f59e0b; background: color-mix(in srgb, #f59e0b 10%, transparent); }
  .notif-pill[data-tone="ok"] { border-color: color-mix(in srgb, #16a34a 45%, var(--line)); color: #16a34a; background: color-mix(in srgb, #16a34a 10%, transparent); }

  @media (min-width: 640px) { .notif-panel { top: 6vh; } }

  /* Mobile: full-width bottom-anchored sheet, one scroll region. */
  @media (max-width: 639px) {
    .notif-panel {
      /* Bottom sheet: pin to both edges. Also override the UA
         dialog:modal max-width (calc(100% - 6px - 2em)) which otherwise
         clamps the sheet ~38px narrower than the viewport. */
      inset: auto 0 0 0;
      transform: none;
      width: 100vw;
      max-width: 100vw;
      max-height: calc(100dvh - max(2.5rem, env(safe-area-inset-top)));
      border-radius: 16px 16px 0 0;
    }
    .notif-header { min-height: 52px; }
    .notif-close { min-height: 40px; min-width: 40px; }
  }
</style>
