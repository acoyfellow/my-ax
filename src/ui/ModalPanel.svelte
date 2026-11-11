<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    open: boolean;
    title?: string;
    closeLabel?: string;
    size?: "compact" | "wide";
    maximizable?: boolean;
    maximized?: boolean;
    panelAttributes?: Record<string, string>;
    fill?: boolean;
    header?: Snippet;
    actions?: Snippet;
    children: Snippet;
    onClose: () => void;
  }

  let {
    open,
    title,
    closeLabel = "Close",
    size = "compact",
    maximizable = false,
    maximized = $bindable(false),
    panelAttributes = {},
    fill = false,
    header,
    actions,
    children,
    onClose,
  }: Props = $props();

  let dialogEl: HTMLDialogElement | null = $state(null);

  $effect(() => {
    if (!dialogEl) return;
    if (open && !dialogEl.open) dialogEl.showModal();
    if (!open && dialogEl.open) dialogEl.close();
  });

  function close() {
    maximized = false;
    onClose();
  }
</script>

<dialog
  bind:this={dialogEl}
  class="modal-panel z-50 overflow-hidden border border-line bg-bg-alt p-0 text-fg"
  data-size={size}
  data-maximized={maximized ? "true" : "false"}
  aria-label={title}
  onclick={(event) => { if (event.target === event.currentTarget) close(); }}
  oncancel={(event) => { event.preventDefault(); close(); }}
  onclose={() => { if (open) close(); }}
  {...panelAttributes}
>
  <div class="modal-panel__header safe-area-appbar">
    <div class="flex items-center gap-2 min-w-0">
      {#if header}{@render header()}{:else if title}<h2 class="truncate text-sm font-semibold text-fg">{title}</h2>{/if}
    </div>
    <div class="flex items-center gap-2">
      {#if actions}{@render actions()}{/if}
      {#if maximizable}
        <button type="button" class="modal-panel__control" onclick={() => (maximized = !maximized)} aria-label={maximized ? "Restore size" : "Maximize"} aria-pressed={maximized} title={maximized ? "Restore size" : "Maximize"}>{maximized ? "⤡" : "⤢"}</button>
      {/if}
      <button type="button" class="modal-panel__control" onclick={close} aria-label={closeLabel}>×</button>
    </div>
  </div>
  <div class="modal-panel__body" data-fill={fill ? "true" : "false"}>
    {@render children()}
  </div>
</dialog>

<style>
  .modal-panel {
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
  .modal-panel[data-size="wide"] {
    width: min(760px, calc(100vw - 1rem));
    height: min(800px, calc(100dvh - 1rem));
    max-height: calc(100dvh - 1rem - 6vh);
  }
  .modal-panel[data-maximized="true"] {
    inset: 0;
    width: 100vw;
    max-width: 100vw;
    height: 100dvh;
    max-height: 100dvh;
    transform: none;
    border-radius: 0;
    border: 0;
  }
  .modal-panel[open] { display: flex; flex-direction: column; }
  .modal-panel::backdrop { background: rgb(0 0 0 / 0.56); backdrop-filter: blur(3px); }
  .modal-panel__header {
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
  .modal-panel__header :global(.modal-panel__control) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 36px;
    min-width: 36px;
    padding: 0 8px;
    color: var(--fg-mut);
    border: 1px solid var(--line);
    border-radius: 7px;
    background: var(--bg);
    font-size: 14px;
    line-height: 1;
  }
  .modal-panel__header :global(.modal-panel__control:hover:not(:disabled)) { color: var(--fg); background: var(--surface-2); }
  .modal-panel__header :global(.modal-panel__control:disabled) { opacity: 0.45; }
  .modal-panel__body[data-fill="true"] { display: flex; flex-direction: column; overflow: hidden; }
  .modal-panel__body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    background: var(--bg-alt);
  }
  @media (min-width: 640px) { .modal-panel:not([data-maximized="true"]) { top: 6vh; } }
  @media (max-width: 639px) {
    .modal-panel__header { min-height: 52px; }
    .modal-panel__header :global(.modal-panel__control) { min-height: 40px; min-width: 40px; }
    .modal-panel:not([data-maximized="true"]) {
      inset: auto 0 0 0;
      transform: none;
      width: 100vw;
      max-width: 100vw;
      max-height: calc(100dvh - max(2.5rem, env(safe-area-inset-top)));
      border-radius: 16px 16px 0 0;
    }
    .modal-panel[data-size="wide"]:not([data-maximized="true"]) {
      height: calc(100dvh - max(2.5rem, env(safe-area-inset-top)));
    }
  }
</style>
