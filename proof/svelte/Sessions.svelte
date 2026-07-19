<script lang="ts">
  // 1:1 port of src/views/SessionsSidebar.tsx + the conversations-sidebar
  // block of chat.js (~250 lines: refreshSessions, loadMoreSessions,
  // buildSessionRow, renameSession, deleteSession, switchToSession,
  // scrollActiveRowIntoView, open/close, "+ New conversation").
  //
  // The component owns the entire <aside> drawer, including its open
  // state. Chat.js triggers open/close via DOM events:
  //
  //   window.dispatchEvent(new Event("my-ax:sessions-open"))
  //   window.dispatchEvent(new Event("my-ax:sessions-close"))
  //   window.dispatchEvent(new Event("my-ax:sessions-toggle"))
  //
  // Switching to a different session still uses location.reload() — the
  // WebSocket reconnect dance with the new session id is cheaper to
  // bootstrap than a stateful in-page swap.

  import { onMount } from "svelte";
  import { captureTitleEpoch, FIRST_SEND_SESSION_ONCE_KEY, isTitleEpochCurrent, RESUME_SESSION_ONCE_KEY, SESSION_KEY, sessionState, setActiveSession, wsState } from "@my-ax/store";
  import { planKeyboardStep, planReorder, reorderAnnouncement, splitPinned } from "./pinned-reorder";

  type SessionRow = {
    id: string;
    name?: string | null;
    updated_at: string;
    status?: string | null;
    pinned?: number | null;
    pin_rank?: string | null;
  };

  const START_FRESH_ONCE_KEY = "my-ax-start-fresh-once";
  const PAGE_SIZE = 50;

  let open = $state(false);
  let sessions = $state<SessionRow[]>([]);
  let cursor = $state<string | null>(null);
  let loading = $state(true);
  let loadingMore = $state(false);
  let errorText = $state<string | null>(null);
  let currentId = $derived(sessionState.id);
  // Pinned/unpinned split (server order is authoritative; splitPinned is a
  // defensive re-sort). See ./pinned-reorder.ts.
  let pinnedRows = $derived(splitPinned(sessions).pinned);
  let unpinnedRows = $derived(splitPinned(sessions).unpinned);
  let pinAnnounce = $state("");

  let scrollEl = $state<HTMLDivElement | undefined>(undefined);

  // ── helpers ───────────────────────────────────────────────────────
  function parseServerTime(iso: string | null | undefined): Date | null {
    if (!iso) return null;
    let s = String(iso);
    // D1 datetime('now') is UTC without a timezone marker. Parse as UTC.
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) s = s.replace(" ", "T") + "Z";
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  function formatSessionTime(iso: string | null | undefined): string {
    const d = parseServerTime(iso);
    if (!d) return "—";
    const diff = Math.max(0, Date.now() - d.getTime());
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 10) return `${min}m ago`;
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    return d.toLocaleString(
      undefined,
      sameDay
        ? { hour: "numeric", minute: "2-digit" }
        : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
    );
  }

  type SessionSignal = "idle" | "running" | "reconnecting" | "error" | "offline";

  function sessionSignal(row: SessionRow, active: boolean): SessionSignal {
    if (active) {
      if (wsState.conn === "offline") return "offline";
      if (wsState.conn === "reconnecting") return "reconnecting";
      if (wsState.status === "thinking" || wsState.status === "running") return "running";
    }
    const status = (row.status || "active").toLowerCase();
    if (status === "running" || status === "thinking") return "running";
    if (status === "error" || status === "failed") return "error";
    if (status === "offline") return "offline";
    return "idle";
  }

  function sessionSignalLabel(signal: SessionSignal): string {
    if (signal === "running") return "Agent is running";
    if (signal === "reconnecting") return "Reconnecting";
    if (signal === "error") return "Last turn failed";
    if (signal === "offline") return "Disconnected";
    return "Ready";
  }

  // ── data ──────────────────────────────────────────────────────────
  function uniqueSessions(rows: SessionRow[]): SessionRow[] {
    return [...new Map(rows.map((row) => [row.id, row])).values()];
  }

  async function refresh() {
    loading = true;
    errorText = null;
    cursor = null;
    const titleEpoch = captureTitleEpoch();
    try {
      const requestedId = localStorage.getItem(SESSION_KEY);
      const r = await fetch(`/api/sessions?limit=${PAGE_SIZE}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      sessions = uniqueSessions(d?.result?.sessions ?? []);
      const active = sessions.find((row) => row.id === requestedId);
      // Chat bootstrap can choose the latest server session while this eager
      // sidebar fetch is in flight. Do not let a stale pre-bootstrap null reset
      // clobber the newly selected app-bar title.
      // Only push the server title if the active session is unchanged AND no
      // newer local title (rename/fork) landed while this list was in flight.
      if (requestedId === localStorage.getItem(SESSION_KEY) && isTitleEpochCurrent(titleEpoch)) setActiveSession(requestedId, active?.name);
      cursor = d?.result?.nextCursor ?? null;
      // Scroll the active row into view after the next paint.
      if (open) setTimeout(scrollActiveIntoView, 100);
    } catch (err: any) {
      errorText = err?.message || String(err);
    } finally {
      loading = false;
    }
  }

  async function loadMore() {
    if (!cursor) return;
    loadingMore = true;
    try {
      const r = await fetch(
        `/api/sessions?limit=${PAGE_SIZE}&before=${encodeURIComponent(cursor)}`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      const page = d?.result?.sessions ?? [];
      sessions = uniqueSessions([...sessions, ...page]);
      cursor = d?.result?.nextCursor ?? null;
    } catch (err) {
      console.error("loadMoreSessions failed:", err);
    } finally {
      loadingMore = false;
    }
  }

  function scrollActiveIntoView() {
    const active = scrollEl?.querySelector('.session-row[data-active="1"]');
    if (!active) return;
    try {
      (active as HTMLElement).scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
    } catch {
      // Fallback (older browsers).
      const el = active as HTMLElement;
      const sc = scrollEl!;
      sc.scrollTop = Math.max(0, el.offsetTop - sc.clientHeight / 2 + el.offsetHeight / 2);
    }
  }

  // ── actions ───────────────────────────────────────────────────────
  function switchTo(id: string) {
    // localStorage is updated synchronously by Chat.svelte's switch handler;
    // unlike the sidebar's previous refresh-time snapshot, it cannot lag across
    // rapid in-place switches.
    if (id === localStorage.getItem(SESSION_KEY)) {
      close();
      return;
    }
    // Do NOT pre-write SESSION_KEY here: switchToSession() in the chat mount
    // guards on `id === localStorage[SESSION_KEY]` and would no-op. Let the
    // chat mount own the session swap; we just request it.
    close();
    // In-place switch: the chat mount closes its socket and reconnects to the
    // new session without a full page reload. Falls back to a reload only if
    // the chat mount isn't listening (defensive).
    let handled = false;
    const ack = () => { handled = true; };
    window.addEventListener("my-ax:switch-session-ack", ack, { once: true });
    window.dispatchEvent(new CustomEvent("my-ax:switch-session", { detail: { id } }));
    setTimeout(() => { window.removeEventListener("my-ax:switch-session-ack", ack); if (!handled) { localStorage.setItem(SESSION_KEY, id); setActiveSession(id, sessions.find((row) => row.id === id)?.name); sessionStorage.setItem(RESUME_SESSION_ONCE_KEY, "1"); location.reload(); } }, 600);
  }

  async function rename(row: SessionRow) {
    const current = row.name || "";
    const next = window.prompt("Rename conversation", current);
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === current) return;
    try {
      const r = await fetch(`/api/sessions/${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!r.ok) {
        const text = await r.text();
        throw new Error("HTTP " + r.status + ": " + text.slice(0, 200));
      }
      if (row.id === currentId) setActiveSession(row.id, trimmed);
      refresh();
    } catch (err: any) {
      console.error("renameSession failed:", err);
      // chat.js's appendError exists for in-chat error toasts. We use the
      // window-global bridge so the Svelte component doesn't depend on it.
      (window as any).__appendError?.(
        "Couldn't rename: " + (err?.message || err),
      );
    }
  }

  async function del(row: SessionRow) {
    const title = row.name || "Untitled";
    if (
      !confirm(
        `Delete conversation "${title}"?\nServer-side history will also be removed.`,
      )
    )
      return;
    try {
      const r = await fetch(`/api/sessions/${encodeURIComponent(row.id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      if (row.id === currentId) {
        localStorage.removeItem(SESSION_KEY);
        location.reload();
        return;
      }
      refresh();
    } catch (err: any) {
      console.error("deleteSession failed:", err);
      (window as any).__appendError?.(
        "Couldn't delete that conversation: " + (err?.message || err),
      );
    }
  }

  // Pin/unpin: server holds the authoritative pinned flag + fractional rank so
  // it syncs across devices. Optimistic local update, reconciled by refresh().
  async function togglePin(row: SessionRow) {
    const nextPinned = row.pinned === 1 ? false : true;
    const prev = row.pinned;
    row.pinned = nextPinned ? 1 : 0;
    sessions = [...sessions];
    try {
      const r = await fetch(`/api/sessions/${encodeURIComponent(row.id)}/pin`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: nextPinned }),
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      pinAnnounce = nextPinned ? `Pinned ${row.name || "conversation"}.` : `Unpinned ${row.name || "conversation"}.`;
      refresh();
    } catch (err: any) {
      row.pinned = prev; // roll back the optimistic flip
      sessions = [...sessions];
      console.error("togglePin failed:", err);
      (window as any).__appendError?.("Couldn't change pin: " + (err?.message || err));
    }
  }

  // Reorder a pinned conversation. `beforeId` is neighbor intent; the server
  // computes the fractional key. Used by both keyboard and (later) DnD.
  async function sendReorder(movedId: string, beforeId: string | null) {
    try {
      const r = await fetch(`/api/sessions/${encodeURIComponent(movedId)}/rank`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ beforeId }),
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      refresh();
    } catch (err: any) {
      console.error("reorderPinned failed:", err);
      (window as any).__appendError?.("Couldn't reorder: " + (err?.message || err));
      refresh(); // resync to server truth
    }
  }

  // ── HTML5 drag-and-drop reorder (pinned group; pointer parity with keyboard) ──
  let dragId = $state<string | null>(null);
  let dragOverId = $state<string | null>(null);
  function onPinDragStart(e: DragEvent, row: SessionRow) {
    dragId = row.id;
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", row.id); } catch {} }
  }
  function onPinDragOver(e: DragEvent, row: SessionRow) {
    if (!dragId || dragId === row.id) return;
    e.preventDefault(); // allow drop
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    dragOverId = row.id;
  }
  function onPinDrop(e: DragEvent, target: SessionRow) {
    e.preventDefault();
    const moved = dragId;
    dragId = null; dragOverId = null;
    if (!moved || moved === target.id) return;
    const order = pinnedRows.map((r) => r.id);
    const toIndex = order.indexOf(target.id);
    if (toIndex < 0) return;
    const plan = planReorder(order, moved, toIndex);
    if (!plan) return;
    // Optimistic local order; server refresh replaces with real fractional keys.
    plan.order.forEach((id, i) => { const s = sessions.find((x) => x.id === id); if (s) s.pin_rank = String(i).padStart(6, "0"); });
    sessions = [...sessions];
    void sendReorder(moved, plan.beforeId);
  }
  function onPinDragEnd() { dragId = null; dragOverId = null; }

  // Accessible keyboard reorder within the pinned group. Up/Down move one slot.
  function reorderPinnedByKey(row: SessionRow, direction: "up" | "down") {
    const order = pinnedRows.map((r) => r.id);
    const plan = planKeyboardStep(order, row.id, direction);
    if (!plan) return; // at the edge
    // Optimistic: reflect the new order locally by nudging pin_rank ordering.
    const moved = sessions.find((s) => s.id === row.id);
    if (moved) {
      // Renumber local pin_rank to the planned order so the derived split
      // re-sorts immediately; server refresh replaces these with real keys.
      plan.order.forEach((id, i) => {
        const s = sessions.find((x) => x.id === id);
        if (s) s.pin_rank = String(i).padStart(6, "0");
      });
      sessions = [...sessions];
    }
    pinAnnounce = reorderAnnouncement(row.name || "Conversation", plan.toIndex, order.length);
    void sendReorder(row.id, plan.beforeId);
  }

  function newConversation() {
    // "New" = blank composer, not "persist an empty DB session". The
    // first SEND creates the durable session row.
    localStorage.removeItem(SESSION_KEY);
    setActiveSession(null);
    sessionStorage.removeItem(RESUME_SESSION_ONCE_KEY);
    sessionStorage.removeItem(FIRST_SEND_SESSION_ONCE_KEY);
    sessionStorage.removeItem("my-ax-pending-first-message");
    sessionStorage.setItem(START_FRESH_ONCE_KEY, "1");
    location.reload();
  }

  // ── open/close ────────────────────────────────────────────────────
  function openSidebar() {
    open = true;
    // chat.js checks this attribute before letting global Esc trigger
    // the chat-cancel handler.
    document.documentElement.setAttribute("data-svelte-sessions-open", "1");
    // Refresh in case anything changed while closed.
    refresh();
    setTimeout(scrollActiveIntoView, 240);
  }
  function close() {
    open = false;
    document.documentElement.removeAttribute("data-svelte-sessions-open");
    // Return focus to whatever opened us. chat.js still owns the hamburger.
    document.getElementById("sessions-button")?.focus();
  }
  function toggle() {
    if (open) close();
    else openSidebar();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && open) close();
  }

  onMount(() => {
    // Eager-fetch so opening the drawer reveals an already-rendered list.
    refresh();
    window.addEventListener("my-ax:sessions-open", openSidebar);
    window.addEventListener("my-ax:sessions-close", close);
    window.addEventListener("my-ax:sessions-toggle", toggle);
    window.addEventListener("my-ax:sessions-refresh", refresh);
    document.addEventListener("keydown", handleKeydown);
    return () => {
      window.removeEventListener("my-ax:sessions-open", openSidebar);
      window.removeEventListener("my-ax:sessions-close", close);
      window.removeEventListener("my-ax:sessions-toggle", toggle);
      window.removeEventListener("my-ax:sessions-refresh", refresh);
      document.removeEventListener("keydown", handleKeydown);
    };
  });
</script>

<!-- Backdrop -->
<div
  class="fixed inset-0 z-40 bg-black/60 transition-opacity duration-150"
  class:opacity-100={open}
  class:opacity-0={!open}
  class:pointer-events-auto={open}
  class:pointer-events-none={!open}
  aria-hidden="true"
  onclick={close}
></div>

<!-- Drawer -->
<aside
  role="dialog"
  aria-modal="true"
  aria-label="Conversations"
  tabindex={-1}
  class="fixed z-50 top-0 bottom-0 left-0 w-[88vw] max-w-[360px] md:w-80 bg-bg-alt border-r border-line shadow-2xl transition-all duration-200 flex flex-col"
  class:translate-x-0={open}
  class:-translate-x-full={!open}
  class:opacity-100={open}
  class:opacity-0={!open}
  class:pointer-events-auto={open}
  class:pointer-events-none={!open}
>
  <header
    class="safe-area-appbar flex-none flex items-center justify-between px-4 py-3 border-b border-line min-h-[48px]"
  >
    <h2 class="text-sm font-semibold text-fg">Conversations</h2>
    <button
      type="button"
      onclick={close}
      class="w-8 h-8 rounded-md flex items-center justify-center text-fg-mut hover:text-fg hover:bg-surface-2 active:bg-surface-3 transition-colors"
      aria-label="Close sidebar"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  </header>

  <div class="flex-none px-3 pt-3 pb-2">
    <button
      type="button"
      onclick={newConversation}
      class="w-full inline-flex items-center justify-center gap-2 rounded-md bg-brand text-white text-sm font-semibold px-3 py-2.5 min-h-[40px] shadow-sm hover:bg-brand/90 active:bg-brand/80 transition-colors"
      aria-label="New conversation"
      title="New conversation"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
      <span>New conversation</span>
    </button>
  </div>

  <div
    bind:this={scrollEl}
    class="flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin] px-2 pb-3"
  >
    {#if loading}
      <div class="px-3 py-4 text-center text-xs text-fg-mut">Loading…</div>
    {:else if errorText}
      <ul class="flex flex-col gap-0.5" aria-live="polite">
        <li class="session-row" style="color: var(--bad); cursor: default;">
          <div class="session-row__main">
            <span class="session-row__title">Failed to load</span>
            <span class="session-row__meta">{errorText}</span>
          </div>
        </li>
      </ul>
    {:else if sessions.length === 0}
      <div class="px-3 py-6 text-center text-xs text-fg-mut">
        No conversations yet.<br />
        Send a message to start one.
      </div>
    {:else}
      {#snippet sessionRowItem(row: SessionRow, pinnedGroup: boolean, indexInGroup: number, groupTotal: number)}
        {@const title = row.name || "Untitled"}
        {@const active = row.id === currentId}
        {@const meta = formatSessionTime(row.updated_at)}
        {@const signal = sessionSignal(row, active)}
        {@const fullTime = parseServerTime(row.updated_at)?.toLocaleString() || ""}
        <li
          class="session-row"
          data-session-id={row.id}
          data-active={active ? "1" : "0"}
          data-pinned={row.pinned === 1 ? "1" : "0"}
          data-drag-over={pinnedGroup && dragOverId === row.id ? "1" : "0"}
          data-dragging={pinnedGroup && dragId === row.id ? "1" : "0"}
          draggable={pinnedGroup ? true : undefined}
          ondragstart={pinnedGroup ? (e) => onPinDragStart(e, row) : undefined}
          ondragover={pinnedGroup ? (e) => onPinDragOver(e, row) : undefined}
          ondrop={pinnedGroup ? (e) => onPinDrop(e, row) : undefined}
          ondragend={pinnedGroup ? onPinDragEnd : undefined}
        >
          <span
            class="session-row__signal"
            data-signal={signal}
            aria-label={sessionSignalLabel(signal)}
            title={sessionSignalLabel(signal)}
          ></span>
          <div
            class="session-row__main"
            tabindex="0"
            role="button"
            aria-label={`Switch to ${title}`}
            onclick={() => switchTo(row.id)}
            onkeydown={(e) => {
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); switchTo(row.id); }
            }}
          >
            <span class="session-row__title">{title}</span>
            <span class="session-row__meta" title={`${fullTime} · ${row.id}`}>{meta} · {row.id.slice(0, 8)}</span>
          </div>
          <div class="session-row__actions">
            <button
              type="button"
              class="session-row__pin"
              data-pinned={row.pinned === 1 ? "1" : "0"}
              aria-pressed={row.pinned === 1}
              aria-label={row.pinned === 1 ? `Unpin ${title}` : `Pin ${title}`}
              title={row.pinned === 1 ? "Unpin" : "Pin to top"}
              onclick={(e) => { e.stopPropagation(); togglePin(row); }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill={row.pinned === 1 ? "currentColor" : "none"} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="12 2 15 9 22 9.5 17 14.5 18.5 21.5 12 17.5 5.5 21.5 7 14.5 2 9.5 9 9" />
              </svg>
            </button>
            {#if pinnedGroup}
              <button
                type="button"
                class="session-row__reorder"
                aria-label={`Reorder ${title}. Use arrow up and down to move; ${indexInGroup + 1} of ${groupTotal}.`}
                title="Reorder (↑/↓)"
                onkeydown={(e) => {
                  if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); reorderPinnedByKey(row, "up"); }
                  else if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); reorderPinnedByKey(row, "down"); }
                }}
                onclick={(e) => e.stopPropagation()}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
                  <circle cx="4" cy="6" r="0.5" /><circle cx="4" cy="12" r="0.5" /><circle cx="4" cy="18" r="0.5" />
                </svg>
              </button>
            {/if}
            <button
              type="button"
              class="session-row__rename"
              aria-label={`Rename ${title}`}
              title="Rename"
              onclick={(e) => { e.stopPropagation(); rename(row); }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </button>
            <a
              class="session-row__export"
              href={`/api/sessions/${encodeURIComponent(row.id)}/export?format=markdown`}
              aria-label={`Export ${title}`}
              title="Export markdown"
              onclick={(e) => e.stopPropagation()}
            >
              ↓
            </a>
            <button
              type="button"
              class="session-row__delete"
              aria-label={`Delete ${title}`}
              title="Delete"
              onclick={(e) => { e.stopPropagation(); del(row); }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </div>
        </li>
      {/snippet}

      <div class="sr-only" aria-live="polite" role="status">{pinAnnounce}</div>
      {#if pinnedRows.length > 0}
        <div class="session-group-header" aria-hidden="true">Pinned</div>
        <ul class="flex flex-col gap-0.5" aria-label="Pinned conversations">
          {#each pinnedRows as row, i (row.id)}
            {@render sessionRowItem(row, true, i, pinnedRows.length)}
          {/each}
        </ul>
        {#if unpinnedRows.length > 0}<div class="session-group-header" aria-hidden="true">Recent</div>{/if}
      {/if}
      <ul class="flex flex-col gap-0.5" aria-live="polite">
        {#each unpinnedRows as row (row.id)}
          {@render sessionRowItem(row, false, 0, 0)}
        {/each}
      </ul>
      {#if cursor}
        <div class="px-2 pt-2">
          <button
            type="button"
            onclick={loadMore}
            disabled={loadingMore}
            class="w-full rounded-md bg-bg/40 border border-line/60 text-fg-mut text-xs px-3 py-2 min-h-[36px] hover:bg-surface-1 hover:text-fg hover:border-line active:bg-surface-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      {/if}
    {/if}
  </div>
</aside>

<style>
  :global(.session-row) {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 6px;
    min-height: 44px;
    color: var(--fg);
    cursor: pointer;
    transition: background-color 80ms;
    position: relative;
  }
  :global(.session-row:hover) {
    background: var(--color-surface-1);
  }
  :global(.session-row[data-active="1"]) {
    background: rgba(246, 130, 31, 0.10);
    color: var(--fg);
  }
  :global(.session-row[data-active="1"] .session-row__title) {
    color: var(--brand);
    font-weight: 500;
  }
  :global(.session-row__signal) {
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--good);
    box-shadow: 0 0 0 2px color-mix(in srgb, currentColor 12%, transparent);
  }
  :global(.session-row__signal[data-signal="idle"]) {
    color: var(--good);
    background: currentColor;
  }
  :global(.session-row__signal[data-signal="error"]) {
    color: var(--bad);
    background: currentColor;
  }
  :global(.session-row__signal[data-signal="offline"]) {
    color: var(--fg-mut);
    background: currentColor;
    opacity: 0.65;
  }
  :global(.session-row__signal[data-signal="reconnecting"]) {
    color: var(--warn);
    background: currentColor;
  }
  :global(.session-row__signal[data-signal="running"]) {
    color: var(--brand);
    /* Conventional circular ring spinner: a full ring with one bright arc
       that rotates, instead of the previous conic-gradient wedge that read
       as a "Pac-Man" mouth. */
    background: transparent;
    box-shadow: none;
    box-sizing: border-box;
    border: 2px solid color-mix(in srgb, currentColor 25%, transparent);
    border-top-color: currentColor;
    animation: session-signal-spin 700ms linear infinite;
  }
  @keyframes session-signal-spin {
    to { transform: rotate(360deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.session-row__signal[data-signal="running"]) {
      animation-duration: 1.8s;
    }
  }
  :global(.session-row__main) {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  :global(.session-row__title) {
    font-size: 13px;
    line-height: 1.3;
    color: var(--fg);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  :global(.session-row__meta) {
    font-size: 10px;
    color: var(--fg-mut);
    line-height: 1.2;
  }
  :global(.session-row__actions) {
    flex-shrink: 0;
    display: flex;
    gap: 2px;
    align-items: center;
  }
  :global(.session-row__rename),
  :global(.session-row__export),
  :global(.session-row__delete),
  :global(.session-row__pin),
  :global(.session-row__reorder) {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border-radius: 4px;
    border: none;
    background: transparent;
    color: var(--fg-mut);
    cursor: pointer;
    opacity: 0;
    transition: opacity 80ms, background-color 80ms, color 80ms;
    display: flex;
    align-items: center;
    justify-content: center;
    text-decoration: none;
  }
  :global(.session-row:hover .session-row__rename),
  :global(.session-row:hover .session-row__export),
  :global(.session-row:hover .session-row__delete),
  :global(.session-row:hover .session-row__pin),
  :global(.session-row:hover .session-row__reorder),
  :global(.session-row:focus-within .session-row__rename),
  :global(.session-row:focus-within .session-row__export),
  :global(.session-row:focus-within .session-row__delete),
  :global(.session-row:focus-within .session-row__pin),
  :global(.session-row:focus-within .session-row__reorder) {
    opacity: 1;
  }
  /* A pinned row keeps its star visible (filled) so its state is always clear. */
  :global(.session-row[data-pinned="1"] .session-row__pin) { opacity: 1; color: var(--color-brand); }
  :global(.session-row__pin:hover),
  :global(.session-row__reorder:hover) {
    background: var(--color-surface-2);
    color: var(--fg);
  }
  :global(.session-row__rename:hover) {
    background: var(--color-surface-2);
    color: var(--fg);
  }
  :global(.session-row__delete:hover) {
    background: rgba(239, 68, 68, 0.15);
    color: rgb(248, 113, 113);
  }
  /* Pinned group: a subtle left accent + header. */
  :global(.session-row[data-pinned="1"]) {
    border-left: 2px solid color-mix(in srgb, var(--color-brand) 55%, transparent);
    background: color-mix(in srgb, var(--color-brand) 4%, transparent);
  }
  /* Drag-and-drop feedback for the pinned group. */
  :global(.session-row[data-dragging="1"]) { opacity: 0.45; }
  :global(.session-row[data-drag-over="1"]) {
    box-shadow: inset 0 2px 0 0 var(--color-brand);
  }
  :global(.session-row[data-pinned="1"] .session-row__reorder) { cursor: grab; }
  .session-group-header {
    padding: 8px 10px 3px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-mut);
  }
  .sr-only {
    position: absolute;
    width: 1px; height: 1px;
    padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0 0 0 0);
    white-space: nowrap; border: 0;
  }
  @media (max-width: 767px) {
    :global(.session-row__rename),
    :global(.session-row__export),
    :global(.session-row__delete),
    :global(.session-row__pin),
    :global(.session-row__reorder) { opacity: 0.6; }
    :global(.session-row[data-pinned="1"] .session-row__pin) { opacity: 1; }
  }
</style>
