<script lang="ts">
  import { onMount } from "svelte";
  import { sessionState } from "@my-ax/store";
  import { pillView, clampPosition, nextSessionIndex, type TurnState } from "../miniplayer-pill";
  import { pipSupport, pipSize, pipLabel } from "../miniplayer-pip";
  import { buildAction, canSend } from "../miniplayer-actions";

  type SessionRow = { id: string; name?: string; status?: string };

  let pos = $state({ x: 24, y: 24 });
  let dragging = $state(false);
  let minimized = $state(false);
  let expanded = $state(false);
  let sessions = $state<SessionRow[]>([]);
  let sessionIndex = $state(0);
  let draft = $state("");
  let sending = $state(false);
  let error = $state<string | null>(null);
  let pipWindow: Window | null = $state(null);

  const current = $derived(sessions[sessionIndex] ?? null);
  const turn: TurnState = $derived(!current ? "offline" : current.status === "running" ? "working" : current.status === "interrupted" ? "stuck" : "idle");
  const view = $derived(pillView({ sessionName: current?.name ?? sessionState.title ?? "No session", turn, minimized: minimized || !expanded }));

  function loadPos() {
    try {
      const raw = localStorage.getItem("my-ax-miniplayer-pos");
      if (raw) pos = JSON.parse(raw) as { x: number; y: number };
    } catch { /* ignore */ }
  }

  function savePos() {
    try { localStorage.setItem("my-ax-miniplayer-pos", JSON.stringify(pos)); } catch { /* ignore */ }
  }

  async function refresh() {
    try {
      const r = await fetch("/api/sessions?limit=20", { credentials: "include" });
      if (!r.ok) return;
      const body = await r.json();
      const rows = (body?.result?.sessions ?? body?.result ?? []) as SessionRow[];
      if (Array.isArray(rows) && rows.length) {
        sessions = rows;
        const active = rows.findIndex((s) => s.id === sessionState.id);
        if (active >= 0) sessionIndex = active;
      }
    } catch { /* offline */ }
  }

  function startDrag(e: PointerEvent) {
    dragging = true;
    const sx = e.clientX - pos.x;
    const sy = e.clientY - pos.y;
    function move(ev: PointerEvent) {
      pos = clampPosition(ev.clientX - sx, ev.clientY - sy, window.innerWidth, window.innerHeight, 260, 56);
    }
    function up() {
      dragging = false;
      savePos();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  async function send() {
    if (!current || !canSend(draft)) return;
    sending = true;
    error = null;
    try {
      const action = buildAction("send", current.id, draft);
      const r = await fetch(`/api/sessions/${encodeURIComponent(action.sessionId)}/inject`, {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: action.content, clientMsgId: `miniplayer:${crypto.randomUUID()}` }),
      });
      if (!r.ok) throw new Error("send failed");
      draft = "";
      await refresh();
    } catch {
      error = "Send failed";
    } finally {
      sending = false;
    }
  }

  async function stop() {
    if (!current) return;
    error = null;
    try {
      const r = await fetch(`/api/sessions/${encodeURIComponent(current.id)}/stop`, { method: "POST", credentials: "include" });
      if (!r.ok) throw new Error("stop failed");
      await refresh();
    } catch {
      error = "Stop failed";
    }
  }

  function cycle(dir: 1 | -1) {
    if (!sessions.length) return;
    sessionIndex = nextSessionIndex(sessionIndex, sessions.length, dir);
    window.dispatchEvent(new CustomEvent("my-ax:switch-session", { detail: { id: sessions[sessionIndex].id } }));
  }

  function expand() {
    expanded = true;
    minimized = false;
    if (current) window.dispatchEvent(new CustomEvent("my-ax:switch-session", { detail: { id: current.id } }));
  }

  async function openPip() {
    if (pipSupport(navigator.userAgent) !== "pip") { error = "PiP needs Chrome desktop"; return; }
    const w = await (document as any).documentPictureInPicture.requestWindow({ width: pipSize(window.innerWidth).width, height: pipSize(window.innerWidth).height });
    pipWindow = w;
    w.document.body.innerHTML = `<div style="font:14px system-ui;padding:12px"><b>${view.label}</b><div>${pipLabel(turn)}</div></div>`;
  }

  function closePip() {
    pipWindow?.close();
    pipWindow = null;
  }

  onMount(() => {
    loadPos();
    void refresh();
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  });
</script>

<div
  class="fixed z-40 select-none"
  style="right:{pos.x}px;bottom:{pos.y}px;touch-action:none"
  role="region"
  aria-label="Miniplayer"
>
  <div
    class="flex items-center gap-2 rounded-full border border-line bg-bg-alt/95 px-3 py-2 shadow-lg backdrop-blur"
    onpointerdown={startDrag}
    style="cursor:{dragging ? 'grabbing' : 'grab'}"
  >
    <span
      class="h-2.5 w-2.5 rounded-full flex-none"
      style="background:{turn === 'working' ? '#22c55e' : turn === 'stuck' ? '#f59e0b' : turn === 'offline' ? '#ef4444' : '#9ca3af'}"
      aria-hidden="true"
    ></span>
    <button type="button" class="max-w-[10rem] truncate text-sm font-medium" onclick={expand} title="Expand">{view.label}</button>
    {#if !minimized && expanded}
      <button type="button" class="text-xs text-fg-mut hover:text-fg" onclick={() => cycle(-1)} title="Previous session">‹</button>
      <button type="button" class="text-xs text-fg-mut hover:text-fg" onclick={() => cycle(1)} title="Next session">›</button>
    {/if}
    {#if view.showStop}
      <button type="button" class="rounded bg-bad/15 px-2 py-1 text-xs font-medium text-bad" onclick={stop}>Stop</button>
    {/if}
    <button type="button" class="text-xs text-fg-mut hover:text-fg" onclick={() => (minimized = !minimized)} title={minimized ? "Restore" : "Minimize"}>{minimized ? "⤢" : "—"}</button>
    {#if pipWindow}
      <button type="button" class="text-xs text-fg-mut hover:text-fg" onclick={closePip} title="Close PiP">✕</button>
    {:else}
      <button type="button" class="text-xs text-fg-mut hover:text-fg" onclick={openPip} title="Float over other windows (Chrome)">⧉</button>
    {/if}
  </div>

  {#if expanded && !minimized}
    <div class="mt-2 w-[19rem] rounded-lg border border-line bg-bg-alt/95 p-3 shadow-lg backdrop-blur">
      <form onsubmit={(e) => { e.preventDefault(); void send(); }} class="flex gap-2">
        <input
          bind:value={draft}
          placeholder="Message this session…"
          maxlength={4000}
          class="min-w-0 flex-1 rounded border border-line bg-bg px-2 py-1.5 text-sm outline-none"
          aria-label="Message"
        />
        <button type="submit" disabled={!canSend(draft) || sending} class="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Send</button>
      </form>
      {#if error}<p class="mt-2 text-xs text-bad">{error}</p>{/if}
      <p class="mt-2 text-xs text-fg-mut">{pipLabel(turn)} · {sessions.length} sessions · ⌥M toggles this pill</p>
    </div>
  {/if}
</div>
