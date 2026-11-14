<script lang="ts">
  import { portal } from "./portal";
  import { alertState, confirmAllowed, dismissToast, promptAllowed, settleCurrent } from "./alert-store.svelte";

  let dialogEl: HTMLDialogElement | null = $state(null);
  let inputEl: HTMLInputElement | null = $state(null);
  let typed = $state("");
  let shownId = $state<number | null>(null);

  const current = $derived(alertState.queue[0] ?? null);
  const canSubmit = $derived(
    !current ? false : current.kind === "confirm" ? confirmAllowed(current.options, typed) : promptAllowed(current.options, typed),
  );

  $effect(() => {
    if (!dialogEl) return;
    if (current && current.id !== shownId) {
      shownId = current.id;
      typed = current.kind === "prompt" ? current.options.value ?? "" : "";
      if (!dialogEl.open) dialogEl.showModal();
      queueMicrotask(() => {
        if (inputEl) {
          inputEl.focus();
          inputEl.select();
        }
      });
    }
    if (!current && dialogEl.open) {
      shownId = null;
      dialogEl.close();
    }
  });

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!current || !canSubmit) return;
    settleCurrent(current.kind === "confirm" ? true : typed.trim());
  }

  function cancel() {
    if (current) settleCurrent(current.kind === "confirm" ? false : null);
  }
</script>

<dialog
  use:portal
  bind:this={dialogEl}
  class="ax-alert"
  data-tone={current?.kind === "confirm" ? current.options.tone ?? "default" : "default"}
  aria-labelledby="ax-alert-title"
  oncancel={(event) => { event.preventDefault(); cancel(); }}
  onclick={(event) => { if (event.target === dialogEl) cancel(); }}
>
  {#if current}
    <form method="dialog" class="ax-alert__card" onsubmit={submit}>
      <h2 id="ax-alert-title" class="ax-alert__title">{current.options.title}</h2>
      {#if current.options.body}<p class="ax-alert__body">{current.options.body}</p>{/if}
      {#if current.kind === "prompt"}
        <input bind:this={inputEl} bind:value={typed} class="ax-alert__input" type="text" aria-label={current.options.title} placeholder={current.options.placeholder ?? ""} autocomplete="off" />
      {:else if current.options.typeToConfirm}
        <label class="ax-alert__confirm-label">
          <span>Type <code>{current.options.typeToConfirm}</code> to confirm</span>
          <input bind:this={inputEl} bind:value={typed} class="ax-alert__input" type="text" autocomplete="off" />
        </label>
      {/if}
      <div class="ax-alert__actions">
        <button type="button" class="ax-alert__button" onclick={cancel}>{current.options.cancelLabel ?? "Cancel"}</button>
        <button type="submit" class="ax-alert__button ax-alert__button--primary" data-alert-confirm disabled={!canSubmit}>{current.options.confirmLabel ?? (current.kind === "prompt" ? "Save" : "OK")}</button>
      </div>
    </form>
  {/if}
</dialog>

<div use:portal class="ax-toasts" aria-live="polite">
  {#each alertState.toasts as toast (toast.id)}
    <button type="button" class="ax-toast" data-tone={toast.tone} onclick={() => dismissToast(toast.id)}>{toast.text}</button>
  {/each}
</div>

<style>
  .ax-alert { margin: auto; padding: 0; border: 1px solid var(--line); border-radius: 12px; background: var(--bg); color: var(--fg); width: min(360px, calc(100vw - 32px)); box-shadow: 0 24px 60px rgb(0 0 0 / 0.28); }
  .ax-alert::backdrop { background: rgb(0 0 0 / 0.45); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); }
  .ax-alert[open] { animation: ax-alert-in 160ms cubic-bezier(0.22, 1, 0.36, 1); }
  @keyframes ax-alert-in { from { opacity: 0; transform: translateY(8px) scale(0.98); } }
  .ax-alert__card { display: grid; gap: 10px; padding: 18px; }
  .ax-alert__title { margin: 0; font-size: 15px; font-weight: 600; }
  .ax-alert__body { margin: 0; font-size: 13px; line-height: 1.45; color: var(--fg-mut); }
  .ax-alert__confirm-label { display: grid; gap: 6px; font-size: 12px; color: var(--fg-mut); }
  .ax-alert__input { width: 100%; min-height: 40px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg-alt); color: var(--fg); font-size: 16px; }
  .ax-alert__input:focus { outline: none; border-color: color-mix(in srgb, var(--brand) 60%, transparent); }
  .ax-alert__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
  .ax-alert__button { min-height: 36px; padding: 0 14px; border: 1px solid var(--line); border-radius: 8px; font-size: 13px; color: var(--fg); background: var(--bg); }
  .ax-alert__button--primary { border-color: transparent; background: var(--brand); color: white; font-weight: 600; }
  .ax-alert[data-tone="danger"] .ax-alert__button--primary { background: var(--bad); }
  .ax-alert__button:disabled { opacity: 0.45; }
  .ax-toasts { position: fixed; z-index: 2147483100; left: 50%; bottom: calc(16px + env(safe-area-inset-bottom)); transform: translateX(-50%); display: grid; gap: 8px; width: min(360px, calc(100vw - 32px)); pointer-events: none; }
  .ax-toast { pointer-events: auto; padding: 10px 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); color: var(--fg); font-size: 13px; text-align: left; box-shadow: 0 10px 30px rgb(0 0 0 / 0.18); }
  .ax-toast[data-tone="error"] { border-color: color-mix(in srgb, var(--bad) 50%, transparent); color: var(--bad); }
  .ax-toast[data-tone="success"] { border-color: color-mix(in srgb, var(--good) 50%, transparent); }
  @media (prefers-reduced-motion: reduce) { .ax-alert[open] { animation: none; } }
</style>
