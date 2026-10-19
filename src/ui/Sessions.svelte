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
  import { captureTitleEpoch, readTabSession, writeTabSession, FIRST_SEND_SESSION_ONCE_KEY, isTitleEpochCurrent, RESUME_SESSION_ONCE_KEY, SESSION_KEY, sessionState, setActiveSession, wsState, rememberSessionEngine } from "@my-ax/store";
  import { planKeyboardStep, planReorder, reorderAnnouncement, splitPinned } from "./pinned-reorder";
  import { groupByTime, matchesTitle, runStateOf } from "./session-groups";
  import { DEFAULT_LAYOUT, LAYOUT_STORAGE_KEY, PANEL_DEFAULT_WIDTH, canDock, clampPanelWidth, parseLayout } from "./side-panel-layout";

  type SessionRow = {
    id: string;
    name?: string | null;
    updated_at: string;
    status?: string | null;
    pinned?: number | null;
    pin_rank?: string | null;
    engine?: string | null;
  };

  const START_FRESH_ONCE_KEY = "my-ax-start-fresh-once";
  const PAGE_SIZE = 50;

  let open = $state(false);
  let viewportWidth = $state(typeof window === "undefined" ? 1280 : window.innerWidth);
  let docked = $derived(canDock(viewportWidth));
  let dockOpen = $state(DEFAULT_LAYOUT.open);
  let panelWidth = $state(DEFAULT_LAYOUT.width);
  let shown = $derived(docked ? dockOpen : open);
  let resizing = false;

  function saveLayout() {
    try { localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ open: dockOpen, width: panelWidth })); } catch {}
  }

  function publishDock() {
    document.documentElement.style.setProperty("--sessions-dock-width", docked && dockOpen ? `${panelWidth}px` : "0px");
  }

  $effect(() => {
    void docked;
    void dockOpen;
    void panelWidth;
    publishDock();
  });

  function startResize(event: PointerEvent) {
    if (!docked) return;
    event.preventDefault();
    resizing = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function moveResize(event: PointerEvent) {
    if (!resizing) return;
    panelWidth = clampPanelWidth(event.clientX, window.innerWidth);
  }

  function endResize() {
    if (!resizing) return;
    resizing = false;
    saveLayout();
  }

  function resetWidth() {
    panelWidth = clampPanelWidth(PANEL_DEFAULT_WIDTH, window.innerWidth);
    saveLayout();
  }

  function resizeByKey(event: KeyboardEvent) {
    const step = event.shiftKey ? 40 : 10;
    if (event.key === "ArrowLeft") panelWidth = clampPanelWidth(panelWidth - step, window.innerWidth);
    else if (event.key === "ArrowRight") panelWidth = clampPanelWidth(panelWidth + step, window.innerWidth);
    else return;
    event.preventDefault();
    saveLayout();
  }
  const SAVED_SESSIONS_KEY = "my-ax-sessions-list";
  function savedSessions(): SessionRow[] {
    try {
      const parsed = JSON.parse(localStorage.getItem(SAVED_SESSIONS_KEY) ?? "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  function saveSessions(rows: SessionRow[]) {
    try { localStorage.setItem(SAVED_SESSIONS_KEY, JSON.stringify(rows.slice(0, PAGE_SIZE))); } catch {}
  }
  let sessions = $state<SessionRow[]>(typeof localStorage === "undefined" ? [] : savedSessions());
  let cursor = $state<string | null>(null);
  let loading = $state(sessions.length === 0);
  let loadingMore = $state(false);
  let errorText = $state<string | null>(null);
  let currentId = $derived(sessionState.id);
  // Pinned/unpinned split (server order is authoritative; splitPinned is a
  // defensive re-sort). See ./pinned-reorder.ts.
  let searchQuery = $state("");
  let visibleSessions = $derived(sessions.filter((row) => matchesTitle(row.name || "Untitled", searchQuery)));
  let pinnedRows = $derived(splitPinned(visibleSessions).pinned);
  let unpinnedRows = $derived(splitPinned(visibleSessions).unpinned);
  let unpinnedGroups = $derived(groupByTime(unpinnedRows, (row) => parseServerTime(row.updated_at), new Date()));
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

  type SessionSignal = "idle" | "running" | "error";

  function sessionSignal(row: SessionRow, active: boolean): SessionSignal {
    if (active && (wsState.status === "thinking" || wsState.status === "running")) return "running";
    const status = (row.status || "active").toLowerCase();
    if (status === "running" || status === "thinking") return "running";
    if (status === "error" || status === "failed") return "error";
    return "idle";
  }

  function sessionSignalLabel(signal: SessionSignal): string {
    if (signal === "running") return "Response in progress";
    if (signal === "error") return "Last turn failed";
    return "Idle";
  }

  function shortSessionTime(iso: string | null | undefined): string {
    const d = parseServerTime(iso);
    if (!d) return "";
    const min = Math.floor(Math.max(0, Date.now() - d.getTime()) / 60000);
    if (min < 1) return "now";
    if (min < 60) return `${min}m`;
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  let menuFor = $state<string | null>(null);
  function toggleMenu(event: Event, id: string) {
    event.stopPropagation();
    menuFor = menuFor === id ? null : id;
  }
  function closeMenu() { menuFor = null; }

  // ── data ──────────────────────────────────────────────────────────
  function uniqueSessions(rows: SessionRow[]): SessionRow[] {
    return [...new Map(rows.map((row) => [row.id, row])).values()];
  }

  async function refreshQuietly() {
    try {
      const r = await fetch(`/api/sessions?limit=${PAGE_SIZE}`, { credentials: "include" });
      if (!r.ok) return;
      const d = await r.json();
      const fresh = uniqueSessions(d?.result?.sessions ?? []);
      const freshIds = new Set(fresh.map((row) => row.id));
      sessions = [...fresh, ...sessions.filter((row) => !freshIds.has(row.id))];
    } catch {}
  }

  async function refresh() {
    loading = sessions.length === 0;
    errorText = null;
    cursor = null;
    const titleEpoch = captureTitleEpoch();
    try {
      const requestedId = readTabSession();
      const r = await fetch(`/api/sessions?limit=${PAGE_SIZE}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      sessions = uniqueSessions(d?.result?.sessions ?? []);
      saveSessions(sessions);
      const active = sessions.find((row) => row.id === requestedId);
      // Chat bootstrap can choose the latest server session while this eager
      // sidebar fetch is in flight. Do not let a stale pre-bootstrap null reset
      // clobber the newly selected app-bar title.
      // Only push the server title if the active session is unchanged AND no
      // newer local title (rename/fork) landed while this list was in flight.
      if (requestedId === readTabSession() && isTitleEpochCurrent(titleEpoch)) setActiveSession(requestedId, active?.name);
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
    if (id === readTabSession()) {
      close();
      return;
    }
    const target = sessions.find((row) => row.id === id);
    const engine = target?.engine === "pi" ? "pi" : "think";
    rememberSessionEngine(id, engine);

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
    setTimeout(() => { window.removeEventListener("my-ax:switch-session-ack", ack); if (!handled) { writeTabSession(id); setActiveSession(id, sessions.find((row) => row.id === id)?.name); sessionStorage.setItem(RESUME_SESSION_ONCE_KEY, "1"); location.reload(); } }, 600);
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
        writeTabSession(null);
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
    writeTabSession(null);
    setActiveSession(null);
    sessionStorage.removeItem(RESUME_SESSION_ONCE_KEY);
    sessionStorage.removeItem(FIRST_SEND_SESSION_ONCE_KEY);
    sessionStorage.removeItem("my-ax-pending-first-message");
    sessionStorage.setItem(START_FRESH_ONCE_KEY, "1");
    location.reload();
  }

  // ── open/close ────────────────────────────────────────────────────
  function openSidebar() {
    if (docked) {
      dockOpen = true;
      saveLayout();
      refresh();
      return;
    }
    open = true;
    // chat.js checks this attribute before letting global Esc trigger
    // the chat-cancel handler.
    document.documentElement.setAttribute("data-svelte-sessions-open", "1");
    // Refresh in case anything changed while closed.
    refresh();
    setTimeout(scrollActiveIntoView, 240);
  }
  function close() {
    if (docked) return;
    open = false;
    document.documentElement.removeAttribute("data-svelte-sessions-open");
    // Return focus to whatever opened us. chat.js still owns the hamburger.
    document.getElementById("sessions-button")?.focus();
  }
  function dismissPanel() {
    if (docked) {
      dockOpen = false;
      saveLayout();
      return;
    }
    close();
  }
  function toggle() {
    if (docked) {
      dockOpen = !dockOpen;
      saveLayout();
      if (dockOpen) refresh();
      return;
    }
    if (open) close();
    else openSidebar();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && open && !docked) close();
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "b") {
      e.preventDefault();
      toggle();
    }
  }

  function onViewportResize() {
    viewportWidth = window.innerWidth;
    if (docked) panelWidth = clampPanelWidth(panelWidth, viewportWidth);
  }

  onMount(() => {
    const saved = parseLayout(localStorage.getItem(LAYOUT_STORAGE_KEY));
    dockOpen = saved.open;
    panelWidth = clampPanelWidth(saved.width, window.innerWidth);
    viewportWidth = window.innerWidth;
    window.addEventListener("resize", onViewportResize, { passive: true });
    // Eager-fetch so opening the drawer reveals an already-rendered list.
    refresh();
    window.addEventListener("my-ax:sessions-open", openSidebar);
    window.addEventListener("my-ax:sessions-close", close);
    window.addEventListener("my-ax:sessions-toggle", toggle);
    window.addEventListener("my-ax:sessions-refresh", refresh);
    const statusPoll = setInterval(() => { if (shown && document.visibilityState === "visible") void refreshQuietly(); }, 4000);
    document.addEventListener("keydown", handleKeydown);
    return () => {
      window.removeEventListener("my-ax:sessions-open", openSidebar);
      window.removeEventListener("my-ax:sessions-close", close);
      window.removeEventListener("my-ax:sessions-toggle", toggle);
      window.removeEventListener("my-ax:sessions-refresh", refresh);
      clearInterval(statusPoll);
      window.removeEventListener("resize", onViewportResize);
      document.removeEventListener("keydown", handleKeydown);
    };
  });
</script>

<!-- Backdrop -->
<div
  class="fixed inset-0 z-40 bg-black/60 transition-opacity duration-150"
  class:opacity-100={open && !docked}
  class:opacity-0={!open || docked}
  class:pointer-events-auto={open && !docked}
  class:pointer-events-none={!open || docked}
  aria-hidden="true"
  onclick={close}
></div>

<!-- Drawer -->
<aside
  role={docked ? "complementary" : "dialog"}
  aria-modal={docked ? undefined : "true"}
  aria-label="Conversations"
  id="sessions-panel"
  data-docked={docked ? "1" : "0"}
  data-open={shown ? "1" : "0"}
  tabindex={-1}
  style={docked ? `width:${panelWidth}px` : undefined}
  class={docked
    ? "fixed z-30 top-[52px] bottom-0 left-0 bg-bg-alt border-r border-line flex flex-col"
    : "fixed z-50 top-0 bottom-0 left-0 w-[88vw] max-w-[360px] bg-bg-alt border-r border-line shadow-2xl transition-all duration-200 flex flex-col"}
  class:hidden={docked && !dockOpen}
  class:translate-x-0={shown}
  class:-translate-x-full={!shown}
  class:opacity-100={shown}
  class:opacity-0={!shown}
  class:pointer-events-auto={shown}
  class:pointer-events-none={!shown}
>
  <div class="safe-area-appbar flex-none flex flex-col gap-2 p-2.5">
    <div class="flex items-center gap-1">
      <button type="button" onclick={newConversation} class="sessions-new flex-1" aria-label="New conversation" title="New conversation">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        <span>New conversation</span>
      </button>
      <button type="button" onclick={dismissPanel} class="sessions-icon" aria-label={docked ? "Hide conversations panel" : "Close sidebar"} title={docked ? "Hide (⌘B)" : "Close"}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg>
      </button>
    </div>
    <label class="sessions-search">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input type="search" bind:value={searchQuery} placeholder="Search" aria-label="Search conversations" />
    </label>
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
      {#snippet rowMenu(row: SessionRow, title: string, pinnedGroup: boolean, indexInGroup: number, groupTotal: number)}
        <div class="session-row__actions">
          <button
            type="button"
            class="session-row__more"
            aria-label={`More actions for ${title}`}
            aria-haspopup="menu"
            aria-expanded={menuFor === row.id}
            onclick={(e) => toggleMenu(e, row.id)}
          >⋯</button>
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
            ></button>
          {/if}
          {#if menuFor === row.id}
            <div class="session-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                class="session-row__pin"
                data-pinned={row.pinned === 1 ? "1" : "0"}
                aria-pressed={row.pinned === 1}
                aria-label={row.pinned === 1 ? `Unpin ${title}` : `Pin ${title}`}
                onclick={(e) => { e.stopPropagation(); closeMenu(); togglePin(row); }}
              >{row.pinned === 1 ? "Unpin" : "Pin"}</button>
              <button type="button" role="menuitem" aria-label={`Rename ${title}`} onclick={(e) => { e.stopPropagation(); closeMenu(); rename(row); }}>Rename</button>
              <a role="menuitem" href={`/api/sessions/${encodeURIComponent(row.id)}/export?format=markdown`} aria-label={`Export ${title}`} onclick={(e) => { e.stopPropagation(); closeMenu(); }}>Export markdown</a>
              <hr />
              <button type="button" role="menuitem" class="danger" aria-label={`Delete ${title}`} onclick={(e) => { e.stopPropagation(); closeMenu(); del(row); }}>Delete</button>
            </div>
          {/if}
        </div>
      {/snippet}

      {#snippet sessionRowItem(row: SessionRow, pinnedGroup: boolean, indexInGroup: number, groupTotal: number)}
        {@const title = row.name || "Untitled"}
        {@const active = row.id === currentId}
        {@const signal = sessionSignal(row, active)}
        {@const fullTime = parseServerTime(row.updated_at)?.toLocaleString() || ""}
        <li
          class={pinnedGroup ? "session-row session-tile" : "session-row"}
          data-session-id={row.id}
          data-active={active ? "1" : "0"}
          data-pinned={row.pinned === 1 ? "1" : "0"}
          data-menu-open={menuFor === row.id ? "1" : "0"}
          data-drag-over={pinnedGroup && dragOverId === row.id ? "1" : "0"}
          data-dragging={pinnedGroup && dragId === row.id ? "1" : "0"}
          draggable={pinnedGroup ? true : undefined}
          ondragstart={pinnedGroup ? (e) => onPinDragStart(e, row) : undefined}
          ondragover={pinnedGroup ? (e) => onPinDragOver(e, row) : undefined}
          ondrop={pinnedGroup ? (e) => onPinDrop(e, row) : undefined}
          ondragend={pinnedGroup ? onPinDragEnd : undefined}
        >
          <span class="session-row__signal" data-signal={signal} role="img" aria-label={sessionSignalLabel(signal)} title={sessionSignalLabel(signal)}></span>
          <div
            class="session-row__main"
            data-run-state={runStateOf(signal)}
            tabindex="0"
            role="button"
            aria-label={`Switch to ${title}`}
            title={`${title} · ${fullTime}`}
            onclick={() => switchTo(row.id)}
            onkeydown={(e) => {
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); switchTo(row.id); }
            }}
          >
            <span class="session-row__title">{title}</span>
            <span class="session-row__meta">{shortSessionTime(row.updated_at)}</span>
          </div>
          {@render rowMenu(row, title, pinnedGroup, indexInGroup, groupTotal)}
        </li>
      {/snippet}

      <div class="sr-only" aria-live="polite" role="status">{pinAnnounce}</div>
      {#if pinnedRows.length > 0}
        <ul class="session-tiles" aria-label="Pinned conversations">
          {#each pinnedRows as row, i (row.id)}
            {@render sessionRowItem(row, true, i, pinnedRows.length)}
          {/each}
        </ul>
        <div class="session-sep" aria-hidden="true"></div>
      {/if}
      {#each unpinnedGroups as bucket (bucket.group)}
        <h3 class="session-group-header">{bucket.group}</h3>
        <ul class="flex flex-col" aria-label={`${bucket.group} conversations`}>
          {#each bucket.rows as row (row.id)}
            {@render sessionRowItem(row, false, 0, 0)}
          {/each}
        </ul>
      {/each}
      {#if visibleSessions.length === 0}
        <p class="px-3 py-4 text-center text-xs text-fg-mut">No conversation matches “{searchQuery}”.</p>
      {/if}
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
  {#if docked}
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize conversations panel"
      aria-valuenow={panelWidth}
      tabindex="0"
      data-resize-handle
      title="Drag to resize, double-click to reset"
      class="absolute top-0 bottom-0 -right-1 w-2 cursor-col-resize hover:bg-brand/30 focus:bg-brand/30 focus:outline-none"
      onpointerdown={startResize}
      onpointermove={moveResize}
      onpointerup={endResize}
      onpointercancel={endResize}
      ondblclick={resetWidth}
      onkeydown={resizeByKey}
    ></div>
  {/if}
</aside>

<svelte:window onclick={closeMenu} />

<style>
  .sessions-new { display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 10px; border-radius: 8px; font-size: 13.5px; font-weight: 500; color: var(--fg); }
  .sessions-new:hover { background: var(--color-surface-1); }
  .sessions-icon { width: 34px; height: 34px; border-radius: 8px; display: grid; place-items: center; color: var(--fg-mut); }
  .sessions-icon:hover { background: var(--color-surface-2); color: var(--fg); }
  .sessions-search { display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 10px; border-radius: 8px; background: var(--color-surface-1); color: var(--fg-mut); }
  .sessions-search:focus-within { box-shadow: 0 0 0 1px color-mix(in srgb, var(--brand) 55%, transparent); }
  .sessions-search input { flex: 1; min-width: 0; height: 100%; padding: 0; border: 0; outline: 0; box-shadow: none; background: transparent; font-size: 13px; color: var(--fg); appearance: none; }
  .sessions-search input::placeholder { color: var(--fg-mut); }
  .session-tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 6px 4px 8px; }
  .session-sep { height: 1px; background: var(--line); margin: 2px 8px 2px; }

  :global(.session-row) { position: relative; display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 10px; border-radius: 7px; color: var(--fg); cursor: pointer; }
  :global(.session-row:hover) { background: var(--color-surface-1); }
  :global(.session-row[data-active="1"]) { background: var(--bg); box-shadow: 0 0 0 1px var(--line), 0 1px 2px rgba(0, 0, 0, 0.04); }
  :global(.session-row__main) { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; height: 100%; outline: none; }
  :global(.session-row__title) { flex: 1; min-width: 0; font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  :global(.session-row__meta) { font-size: 11.5px; color: var(--fg-mut); font-variant-numeric: tabular-nums; white-space: nowrap; }
  :global(.session-row__main:focus-visible) { box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand) 45%, transparent); border-radius: 6px; }

  :global(.session-tile) { flex-direction: column; align-items: stretch; justify-content: space-between; gap: 0; height: 56px; padding: 8px 10px; border-radius: 9px; background: var(--bg); border: 1px solid var(--line); box-shadow: none; }
  :global(.session-tile:hover) { background: var(--bg); border-color: color-mix(in srgb, var(--fg) 20%, transparent); }
  :global(.session-tile[data-active="1"]) { border-color: var(--brand); box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand) 16%, transparent); }
  :global(.session-tile .session-row__main) { flex-direction: column; align-items: flex-start; justify-content: space-between; gap: 2px; }
  :global(.session-tile .session-row__title) { flex: none; width: 100%; font-weight: 500; font-size: 13px; padding-right: 14px; }
  :global(.session-tile .session-row__signal) { position: absolute; top: 10px; right: 10px; }
  :global(.session-tile .session-row__actions) { position: absolute; right: 4px; bottom: 4px; }

  :global(.session-row__signal) { flex: none; width: 7px; height: 7px; border-radius: 999px; background: color-mix(in srgb, var(--fg-mut) 45%, transparent); }
  :global(.session-row__signal[data-signal="error"]) { background: var(--bad); }
  :global(.session-row__signal[data-signal="running"]) { width: 10px; height: 10px; background: transparent; box-sizing: border-box; border: 2px solid color-mix(in srgb, var(--good) 25%, transparent); border-top-color: var(--good); animation: session-signal-spin 700ms linear infinite; }
  :global(.session-tile .session-row__signal[data-signal="running"]) { top: 9px; right: 9px; }
  @keyframes session-signal-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { :global(.session-row__signal[data-signal="running"]) { animation-duration: 1.8s; } }

  :global(.session-row__actions) { flex: none; display: flex; align-items: center; }
  :global(.session-tiles > li:nth-child(odd) .session-menu) { right: auto; left: -2px; }
  :global(.session-row__more) { display: grid; width: 22px; height: 22px; border-radius: 5px; place-items: center; color: var(--fg-mut); font-size: 15px; line-height: 1; opacity: 0; }
  :global(.session-row__more:hover) { background: var(--color-surface-2); color: var(--fg); }
  :global(.session-row:hover .session-row__more), :global(.session-row:focus-within .session-row__more), :global(.session-row[data-menu-open="1"] .session-row__more) { opacity: 1; }
  :global(.session-row:not(.session-tile) .session-row__actions) { position: absolute; right: 6px; top: 5px; }
  :global(.session-row:not(.session-tile):hover .session-row__meta), :global(.session-row:not(.session-tile):focus-within .session-row__meta), :global(.session-row:not(.session-tile)[data-menu-open="1"] .session-row__meta) { visibility: hidden; }
  :global(.session-row__reorder) { position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; }
  :global(.session-row__reorder:focus-visible) { position: static; width: 22px; height: 22px; opacity: 1; border-radius: 5px; box-shadow: 0 0 0 2px var(--brand); }

  :global(.session-menu) { position: absolute; right: 0; top: calc(100% + 4px); z-index: 20; width: 172px; padding: 4px; background: var(--bg); border: 1px solid var(--line); border-radius: 9px; box-shadow: 0 12px 28px -10px rgba(0, 0, 0, 0.28); cursor: default; }
  :global(.session-menu > button), :global(.session-menu > a) { display: flex; align-items: center; width: 100%; height: 30px; padding: 0 8px; border-radius: 6px; font-size: 13px; color: var(--fg); text-decoration: none; text-align: left; }
  :global(.session-menu > button:hover), :global(.session-menu > a:hover) { background: var(--color-surface-1); }
  :global(.session-menu > .danger) { color: var(--bad); }
  :global(.session-menu > hr) { border: 0; border-top: 1px solid var(--line); margin: 4px 2px; }

  :global(.session-row[data-dragging="1"]) { opacity: 0.45; }
  :global(.session-row[data-drag-over="1"]) { box-shadow: inset 0 2px 0 0 var(--brand); }
  .session-group-header { padding: 12px 10px 4px; font-size: 11px; font-weight: 600; color: var(--fg-mut); }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
  @media (max-width: 767px) {
    :global(.session-row__more) { opacity: 1; }
    :global(.session-row:not(.session-tile) .session-row__meta) { visibility: hidden; }
  }
</style>
