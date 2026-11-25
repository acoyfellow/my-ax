<script lang="ts">
  import { onDestroy } from "svelte";
  import { clampMenuPosition, submenuPosition, type ContextMenuIcon, type ContextMenuItem, type ContextMenuSubmenuItem, type MenuPoint } from "./context-menu";
  import ContextMenu from "./ContextMenu.svelte";

  interface Props {
    open: boolean;
    x: number;
    y: number;
    items: ContextMenuItem[];
    label?: string;
    nested?: boolean;
    onClose: () => void;
  }

  const { open, x, y, items, label = "Context menu", nested = false, onClose }: Props = $props();

  let menuEl = $state<HTMLDivElement | null>(null);
  let pos = $state<MenuPoint>({ x: 0, y: 0 });
  let openSubId = $state<string | null>(null);
  let subPos = $state<MenuPoint>({ x: 0, y: 0 });
  let subCloseTimer: ReturnType<typeof setTimeout> | null = null;

  function clearSubTimer() {
    if (subCloseTimer) {
      clearTimeout(subCloseTimer);
      subCloseTimer = null;
    }
  }

  $effect(() => {
    if (!open) {
      openSubId = null;
      clearSubTimer();
      return;
    }
    pos = { x, y };
    queueMicrotask(() => {
      if (!menuEl) return;
      const rect = menuEl.getBoundingClientRect();
      pos = clampMenuPosition(
        { x, y },
        { width: rect.width || 184, height: rect.height || 160 },
        { width: window.innerWidth, height: window.innerHeight },
      );
      if (!nested) menuEl.focus({ preventScroll: true });
    });
  });

  $effect(() => {
    if (!open || nested) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-context-menu]")) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    const onBlur = () => onClose();
    const onScroll = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("[data-context-menu]")) return;
      onClose();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", onBlur);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("scroll", onScroll, true);
    };
  });

  onDestroy(clearSubTimer);

  function openSubmenu(item: ContextMenuSubmenuItem, triggerEl: HTMLElement) {
    clearSubTimer();
    const r = triggerEl.getBoundingClientRect();
    subPos = submenuPosition(
      { left: r.left, top: r.top, width: r.width, height: r.height },
      { width: 176, height: Math.max(48, item.items.length * 32 + 12) },
      { width: window.innerWidth, height: window.innerHeight },
    );
    openSubId = item.id;
  }

  function scheduleSubClose() {
    clearSubTimer();
    subCloseTimer = setTimeout(() => {
      openSubId = null;
    }, 180);
  }

  function handleAction(item: Extract<ContextMenuItem, { kind: "action" }>, event: MouseEvent) {
    event.stopPropagation();
    if (item.disabled) return;
    onClose();
    item.onSelect?.();
  }

  let activeSubmenu = $derived(
    items.find((item): item is ContextMenuSubmenuItem => item.kind === "submenu" && item.id === openSubId) ?? null,
  );
</script>

{#snippet menuIcon(icon: ContextMenuIcon)}
  <svg class="ctx-menu__icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {#if icon === "pin"}
      <path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>
    {:else if icon === "unpin"}
      <path d="M2 2l20 20"/><path d="M12 17v5"/><path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11"/><path d="M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89"/>
    {:else if icon === "size"}
      <rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="18" height="7" rx="1.5"/>
    {:else if icon === "rename"}
      <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/>
    {:else if icon === "export"}
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
    {:else if icon === "archive"}
      <rect x="2" y="4" width="20" height="5" rx="1"/><path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"/><path d="M10 13h4"/>
    {:else if icon === "unarchive"}
      <rect x="2" y="4" width="20" height="5" rx="1"/><path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"/><path d="M12 17v-6"/><path d="m9 14 3-3 3 3"/>
    {:else if icon === "delete"}
      <path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
    {:else if icon === "sparkles"}
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>
    {:else}
      <line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>
    {/if}
  </svg>
{/snippet}

{#if open}
  <div
    bind:this={menuEl}
    class="ctx-menu"
    role="menu"
    tabindex="-1"
    aria-label={label}
    data-context-menu={nested ? "nested" : "root"}
    style={`left:${pos.x}px;top:${pos.y}px;`}
    oncontextmenu={(e) => e.preventDefault()}
    onmouseenter={clearSubTimer}
  >
    {#each items as item, idx (item.kind === "action" || item.kind === "submenu" ? item.id : `${item.kind}-${idx}`)}
      {#if item.kind === "separator"}
        <hr class="ctx-menu__sep" />
      {:else if item.kind === "header"}
        <div class="ctx-menu__header" role="presentation">{item.label}</div>
      {:else if item.kind === "submenu"}
        <button
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={openSubId === item.id}
          class="ctx-menu__item ctx-menu__item--sub"
          data-open={openSubId === item.id ? "1" : "0"}
          onmouseenter={(e) => openSubmenu(item, e.currentTarget)}
          onmouseleave={scheduleSubClose}
          onclick={(e) => { e.stopPropagation(); openSubmenu(item, e.currentTarget); }}
          onkeydown={(e) => {
            if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openSubmenu(item, e.currentTarget);
            }
          }}
        >
          {#if item.icon}{@render menuIcon(item.icon)}{/if}
          <span class="ctx-menu__label">{item.label}</span>
          {#if item.hint}<span class="ctx-menu__hint">{item.hint}</span>{/if}
          <span class="ctx-menu__chev" aria-hidden="true">›</span>
        </button>
      {:else if item.href}
        <a
          role="menuitem"
          href={item.href}
          class="ctx-menu__item"
          class:ctx-menu__item--danger={item.tone === "danger"}
          onmouseenter={scheduleSubClose}
          onclick={(e) => handleAction(item, e)}
        >
          {#if item.checked !== undefined}<span class="ctx-menu__check" aria-hidden="true">{item.checked ? "✓" : ""}</span>{:else if item.icon}{@render menuIcon(item.icon)}{/if}
          <span class="ctx-menu__label">{item.label}</span>
          {#if item.hint}<span class="ctx-menu__hint">{item.hint}</span>{/if}
        </a>
      {:else}
        <button
          type="button"
          role="menuitem"
          disabled={item.disabled}
          class="ctx-menu__item"
          class:ctx-menu__item--danger={item.tone === "danger"}
          onmouseenter={scheduleSubClose}
          onclick={(e) => handleAction(item, e)}
        >
          {#if item.checked !== undefined}<span class="ctx-menu__check" aria-hidden="true">{item.checked ? "✓" : ""}</span>{:else if item.icon}{@render menuIcon(item.icon)}{/if}
          <span class="ctx-menu__label">{item.label}</span>
          {#if item.hint}<span class="ctx-menu__hint">{item.hint}</span>{/if}
        </button>
      {/if}
    {/each}
  </div>

  {#if activeSubmenu}
    <ContextMenu
      open={true}
      x={subPos.x}
      y={subPos.y}
      items={activeSubmenu.items}
      label={activeSubmenu.label}
      nested={true}
      {onClose}
    />
  {/if}
{/if}

<style>
  .ctx-menu {
    position: fixed;
    z-index: 90;
    min-width: 176px;
    max-width: 248px;
    padding: 5px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--bg);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.24), 0 2px 8px rgba(0, 0, 0, 0.12);
    display: flex;
    flex-direction: column;
    gap: 1px;
    color: var(--fg);
  }
  .ctx-menu__header {
    padding: 5px 8px 3px;
    font-size: 11px;
    font-weight: 600;
    color: var(--fg-mut);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ctx-menu__sep {
    border: 0;
    border-top: 1px solid var(--line);
    margin: 4px 2px;
  }
  .ctx-menu__item {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    padding: 6px 8px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--fg);
    font: inherit;
    font-size: 12.5px;
    text-align: left;
    text-decoration: none;
    cursor: pointer;
    transition: background-color 90ms ease;
  }
  .ctx-menu__item:hover,
  .ctx-menu__item:focus-visible,
  .ctx-menu__item[data-open="1"] {
    background: var(--color-surface-2);
    outline: none;
  }
  .ctx-menu__item:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .ctx-menu__item--danger {
    color: var(--bad);
  }
  .ctx-menu__item--danger:hover {
    background: color-mix(in srgb, var(--bad) 12%, transparent);
  }
  .ctx-menu__icon {
    flex: none;
    color: var(--fg-mut);
  }
  .ctx-menu__item--danger .ctx-menu__icon {
    color: var(--bad);
  }
  .ctx-menu__check {
    width: 12px;
    flex: none;
    font-size: 11px;
    color: var(--brand);
    text-align: center;
  }
  .ctx-menu__label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ctx-menu__hint {
    flex: none;
    font-size: 11px;
    color: var(--fg-mut);
  }
  .ctx-menu__chev {
    flex: none;
    font-size: 14px;
    line-height: 1;
    color: var(--fg-mut);
  }
</style>
