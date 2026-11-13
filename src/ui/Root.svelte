<script lang="ts">
  import { onMount, tick } from "svelte";
  import Chat from "./Chat.svelte";
  import NavIconButton from "./NavIconButton.svelte";
  import SessionSignalDot from "./SessionSignal.svelte";
  import { sessionSignalOf } from "./session-signal";
  import { fixedSessionBinding, type SessionBinding } from "./session-binding";
  import { dragOffset, settlesOpen } from "./top-drawer-drag";
  import { registerRootSender, routeComposerTo } from "./composer-route.svelte";

  type Child = { id: string; name: string; status: string };

  let rootId = $state<string | null>(null);
  let binding = $state<SessionBinding | null>(null);
  let chatGeneration = $state(0);
  let loadError = $state<string | null>(null);
  let children = $state<Child[]>([]);
  let open = $state(false);
  let drawerEl = $state<HTMLElement | null>(null);
  let layerEl = $state<HTMLElement | null>(null);
  let drag = $state<{ pointerId: number; startY: number; direction: "open" | "close"; height: number; offset: number; moved: boolean } | null>(null);
  const reveal = $derived(drag ? drag.offset : open ? null : 0);
  let clearing = $state(false);
  let menuOpen = $state(false);
  let chatStatus = $state<string | null>(null);
  const rootSignal = $derived(sessionSignalOf(chatStatus));
  async function loadChildren(id: string) {
    const response = await fetch(`/api/sessions/${encodeURIComponent(id)}/children`, { credentials: "include" }).catch(() => null);
    const body = await response?.json().catch(() => null);
    const rows = body?.result?.children;
    children = Array.isArray(rows) ? (rows as Child[]) : [];
  }

  async function ensureRoot(): Promise<string | null> {
    if (rootId) return rootId;
    loadError = null;
    const response = await fetch("/api/root", { credentials: "include" }).catch(() => null);
    const body = await response?.json().catch(() => null);
    if (!response?.ok || !body?.ok) { loadError = body?.error?.message ?? "Root is not available"; return null; }
    rootId = body.result.id as string;
    binding = fixedSessionBinding(rootId);
    return rootId;
  }

  async function openPanel() {
    open = true;
    routeComposerTo("root");
    await tick();
    document.querySelector<HTMLTextAreaElement>("[data-composer-target=root] textarea[aria-label=Message]")?.focus();
    const id = await ensureRoot();
    if (id) void loadChildren(id);
  }

  function closePanel() {
    open = false;
    routeComposerTo("page");
  }

  async function clear() {
    if (!rootId || clearing) return;
    if (!confirm("Clear this conversation? Its messages are removed.")) return;
    clearing = true;
    const response = await fetch("/api/root/clear", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: rootId }) }).catch(() => null);
    const body = await response?.json().catch(() => null);
    clearing = false;
    if (!response?.ok) { loadError = body?.error?.message ?? "Clear failed"; return; }
    loadError = null;
    chatGeneration += 1;
  }

  function drawerHeight(): number {
    return drawerEl?.getBoundingClientRect().height || window.innerHeight * 0.88;
  }

  function startDrag(event: PointerEvent, direction: "open" | "close") {
    if (event.button !== 0) return;
    if (direction === "open") void ensureRoot();
    const height = drawerHeight();
    drag = { pointerId: event.pointerId, startY: event.clientY, direction, height, offset: direction === "open" ? 0 : height, moved: false };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const offset = dragOffset(drag.startY, event.clientY, drag.height, drag.direction);
    drag = { ...drag, offset, moved: drag.moved || Math.abs(event.clientY - drag.startY) > 6 };
  }

  function endDrag(event: PointerEvent) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const finished = drag;
    drag = null;
    if (!finished.moved) {
      if (finished.direction === "open") { if (open) closePanel(); else void openPanel(); }
      return;
    }
    if (settlesOpen(finished.offset, finished.height)) void openPanel();
    else closePanel();
  }

  function onDrawerKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && open) { event.preventDefault(); closePanel(); }
  }

  onMount(() => {
    const app = layerEl?.closest("[data-svelte-hono-mount]");
    if (layerEl && app) app.append(layerEl);
    const onOpen = () => { void openPanel(); };
    window.addEventListener("my-ax:root-open", onOpen);
    if (new URL(location.href).searchParams.get("action") === "root") void openPanel();
    return () => {
      window.removeEventListener("my-ax:root-open", onOpen);
      layerEl?.remove();
    };
  });
</script>

<svelte:window onkeydown={onDrawerKeydown} />

<NavIconButton label={open ? "Close root" : "Open root"} title="Root (click or pull down)" aria-expanded={open} aria-controls="root-drawer" onpointerdown={(event) => startDrag(event, "open")} onpointermove={moveDrag} onpointerup={endDrag} onpointercancel={endDrag} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (open) closePanel(); else void openPanel(); } }} data-root-button="" class="root-button">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" /></svg>
</NavIconButton>

<div class="root-layer" bind:this={layerEl}>
{#if open || drag}
  <button type="button" class="root-scrim" aria-label="Close root" tabindex="-1" onclick={closePanel} style:opacity={reveal === null ? 1 : reveal / (drag?.height || drawerHeight())}></button>
{/if}
<section
  bind:this={drawerEl}
  id="root-drawer"
  class="root-drawer"
  data-root-panel=""
  data-root-drawer={open ? "open" : "closed"}
  data-dragging={drag ? "true" : "false"}
  aria-label="Root"
  aria-hidden={!open && !drag}
  inert={!open && !drag}
  style:transform={reveal === null ? "translateY(0)" : reveal === 0 ? "translateY(calc(-100% - 48px))" : `translateY(calc(-100% + ${reveal}px))`}
>
  <div class="root-drawer__header">
    <SessionSignalDot signal={rootSignal} />
    <h2 class="truncate text-sm font-semibold text-fg">Root</h2>
    <div class="root-menu" data-root-menu>
      <button type="button" class="root-drawer__icon" onclick={() => (menuOpen = !menuOpen)} aria-haspopup="menu" aria-expanded={menuOpen} aria-label="Root actions" title="More">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
      </button>
      {#if menuOpen}
        <div class="root-menu__list" role="menu">
          <button type="button" role="menuitem" onclick={() => { menuOpen = false; void clear(); }} disabled={clearing || !rootId} data-root-clear>Clear conversation</button>
        </div>
      {/if}
    </div>
    <span class="flex-1"></span>
    <button type="button" class="root-drawer__icon" onclick={closePanel} aria-label="Close root" title="Close (Esc)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  </div>
  <div class="root-content">
    {#if loadError}
      <p class="root-error text-bad" role="alert">{loadError}</p>
    {/if}
    {#if binding && (open || drag)}
      <div class="root-chat">
        {#key chatGeneration}
          <Chat {binding} composerHidden onSender={registerRootSender} onStatus={(status) => (chatStatus = status)} />
        {/key}
      </div>
      {#if children.length}
        <div class="root-tree">
          <div class="root-tree-head">Started from here</div>
          {#each children as child (child.id)}
            <a class="root-child" href={`/?session=${encodeURIComponent(child.id)}`} onclick={closePanel}>{child.name}</a>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
  <div class="root-drawer__handle" role="presentation" onpointerdown={(event) => startDrag(event, "close")} onpointermove={moveDrag} onpointerup={endDrag} onpointercancel={endDrag} data-root-handle="">
    <span aria-hidden="true"></span>
  </div>
</section>
</div>

<style>
  :global(.root-button) { touch-action: none; }
  .root-scrim { position: fixed; inset: 0 0 var(--page-composer-height, 72px) 0; z-index: 2147483000; background: rgb(0 0 0 / 0.35); border: 0; padding: 0; transition: opacity 220ms ease; }
  .root-drawer { position: fixed; top: 0; left: 0; right: 0; z-index: 2147483001; height: calc(100dvh - var(--page-composer-height, 72px)); display: flex; flex-direction: column; background: var(--bg-alt); color: var(--fg); border-bottom: 1px solid var(--line); border-radius: 0; box-shadow: 0 24px 60px -20px rgb(0 0 0 / 0.45); padding-top: env(safe-area-inset-top); transition: transform 260ms cubic-bezier(0.32, 0.72, 0, 1); will-change: transform; }
  .root-drawer[data-dragging="true"] { transition: none; }
  .root-drawer[data-root-drawer="open"][data-dragging="false"] { box-shadow: none; }
  .root-drawer__header { flex: none; display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-bottom: 1px solid var(--line); }
  .root-drawer__icon { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 8px; color: var(--fg-mut); }
  .root-drawer__icon:hover { color: var(--fg); background: var(--surface-2); }
  .root-drawer__icon :global(svg) { width: 18px; height: 18px; }
  .root-drawer__handle { flex: none; display: flex; justify-content: center; align-items: center; height: 22px; cursor: grab; touch-action: none; }
  .root-drawer__handle span { width: 44px; height: 5px; border-radius: 999px; background: color-mix(in srgb, var(--fg-mut) 45%, transparent); }
  @media (prefers-reduced-motion: reduce) { .root-drawer, .root-scrim { transition: none; } }
  .root-menu { position: relative; }
  .root-menu__list { position: absolute; left: 0; top: calc(100% + 4px); z-index: 30; min-width: 180px; padding: 4px; background: var(--bg); border: 1px solid var(--line); border-radius: 9px; box-shadow: 0 12px 28px -10px rgb(0 0 0 / 0.28); }
  .root-menu__list button { display: flex; align-items: center; width: 100%; min-height: 36px; padding: 0 10px; border-radius: 6px; font-size: 13px; color: var(--fg); text-align: left; }
  .root-menu__list button:hover:not(:disabled) { background: var(--surface-2); }
  .root-menu__list button:disabled { opacity: 0.45; }
  .root-content { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .root-chat { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .root-error { padding: 0.75rem 1rem; font-size: 0.875rem; }
  .root-tree { flex: none; border-top: 1px solid var(--line); padding: 10px 16px; display: flex; flex-direction: column; gap: 4px; max-height: 30%; overflow-y: auto; }
  .root-tree-head { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--fg-mut); }
  .root-child { color: var(--fg); text-decoration: none; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .root-child:hover { text-decoration: underline; }
</style>
