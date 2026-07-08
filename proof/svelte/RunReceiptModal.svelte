<script lang="ts">
  // Nested Run Receipt modal.
  //
  // Previously "Open source receipt" (Attention) and any /runs/<id> deep link
  // fell through Chat.followDeepLink to location.assign(), a full-page load
  // that dismissed the open modal and replaced the conversation context. This
  // component keeps the receipt NESTED: it layers a <dialog> above the current
  // context (conversation or the Attention panel), fetches receipt data from
  // the JSON APIs (no navigation), pushes a history entry so Back closes the
  // receipt and returns to the parent, and resolves direct/deep links by
  // opening the modal over the live app shell on bootstrap.

  import { onMount } from "svelte";

  type RunActor = { id?: string; kind?: string; mode?: string } | undefined;
  type RunEvent = { type: string; ts: string; actor?: RunActor; data?: Record<string, unknown> };
  type Run = { id: string; status: string; task_summary: string; created_at: string };

  const RUN_RECEIPT_RE = /^\/runs\/([^/?#]+)$/;

  let open = $state(false);
  let dialogEl: HTMLDialogElement | null = null;
  let runId = $state<string | null>(null);
  let run = $state<Run | null>(null);
  let events = $state<RunEvent[]>([]);
  let loading = $state(false);
  let errorText = $state<string | null>(null);
  // True while we own a pushed history entry, so closing can step back exactly
  // once without escaping the app when we were deep-linked in directly.
  let pushedHistory = false;

  function parseRunReceiptId(href: string): string | null {
    try {
      const url = new URL(href, location.origin);
      if (url.origin !== location.origin) return null;
      const match = RUN_RECEIPT_RE.exec(url.pathname);
      return match ? decodeURIComponent(match[1]) : null;
    } catch {
      return null;
    }
  }

  async function load(id: string) {
    loading = true;
    errorText = null;
    run = null;
    events = [];
    try {
      const [runRes, eventsRes] = await Promise.all([
        fetch(`/api/runs/${encodeURIComponent(id)}`, { credentials: "include" }),
        fetch(`/api/runs/${encodeURIComponent(id)}/events`, { credentials: "include" }),
      ]);
      if (runRes.status === 404) throw new Error("This receipt does not exist, or it is not owned by this Access identity.");
      if (!runRes.ok) throw new Error(`Could not load run receipt (HTTP ${runRes.status}).`);
      const runBody = await runRes.json();
      run = runBody?.result?.run ?? null;
      if (eventsRes.ok) {
        const eventsBody = await eventsRes.json();
        events = Array.isArray(eventsBody?.result?.events) ? eventsBody.result.events : [];
      }
    } catch (error) {
      errorText = error instanceof Error ? error.message : String(error);
    } finally {
      loading = false;
    }
  }

  // pushHistory=true when the open originates from an in-app click (we add a
  // history entry so Back returns to the parent). On a direct deep link the
  // /runs/<id> URL is already the current entry, so we do not push again.
  async function openReceipt(id: string, pushHistory: boolean) {
    runId = id;
    open = true;
    await Promise.resolve();
    if (dialogEl && !dialogEl.open) dialogEl.showModal();
    if (pushHistory) {
      try { history.pushState({ myAxRunReceipt: id }, "", `/runs/${encodeURIComponent(id)}`); pushedHistory = true; } catch { pushedHistory = false; }
    }
    void load(id);
  }

  // stepBack=true issues history.back() so a user clicking Close mirrors the
  // Back button. popstate-driven closes pass stepBack=false (the browser
  // already moved the history pointer).
  function closeReceipt(stepBack: boolean) {
    if (!open) return;
    open = false;
    runId = null;
    run = null;
    events = [];
    errorText = null;
    if (dialogEl?.open) dialogEl.close();
    if (stepBack && pushedHistory) {
      pushedHistory = false;
      history.back();
    } else if (!pushedHistory) {
      // Deep-linked directly onto /runs/<id> with no parent app entry to
      // return to: normalize the URL to the app root so Back doesn't loop.
      try { history.replaceState(null, "", "/"); } catch { /* ignore */ }
    } else {
      pushedHistory = false;
    }
  }

  onMount(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ runId?: string; href?: string }>).detail;
      const id = detail?.runId ?? (detail?.href ? parseRunReceiptId(detail.href) : null);
      if (id) void openReceipt(id, true);
    };
    const onPopState = () => {
      // Back/forward: show the receipt iff the URL is a receipt route, else close.
      const id = parseRunReceiptId(location.pathname);
      if (id) {
        if (!open || runId !== id) { pushedHistory = false; void openReceipt(id, false); }
      } else if (open) {
        closeReceipt(false);
      }
    };
    window.addEventListener("my-ax:run-receipt-open", onOpen as EventListener);
    window.addEventListener("popstate", onPopState);
    // Direct/deep link: if the app shell boots on /runs/<id>, open the modal
    // over it instead of leaving the server-rendered standalone page as the
    // only surface. pushedHistory stays false — this IS the current entry.
    const bootId = parseRunReceiptId(location.pathname);
    if (bootId) void openReceipt(bootId, false);
    return () => {
      window.removeEventListener("my-ax:run-receipt-open", onOpen as EventListener);
      window.removeEventListener("popstate", onPopState);
    };
  });
</script>

{#if open}
  <dialog
    bind:this={dialogEl}
    class="run-receipt-modal z-50 w-[min(900px,calc(100vw-1rem))] max-h-[min(900px,calc(100dvh-1rem))] overflow-hidden border border-line bg-bg-alt p-0 text-fg"
    aria-label="Run Receipt"
    data-run-receipt-modal
    onclick={(event) => event.target === event.currentTarget && closeReceipt(true)}
    oncancel={(event) => { event.preventDefault(); closeReceipt(true); }}
    onclose={() => { if (open) closeReceipt(true); }}
  >
    <div class="run-receipt-modal__header safe-area-appbar">
      <div class="min-w-0">
        <h2 class="text-sm font-semibold text-fg">Run Receipt</h2>
        <p class="truncate text-[11px] text-fg-mut">{runId}</p>
      </div>
      <button type="button" onclick={() => closeReceipt(true)} class="run-receipt-modal__close" aria-label="Close run receipt">×</button>
    </div>
    <div class="run-receipt-modal__body" data-run-receipt-scroll>
      {#if loading}
        <p class="text-sm text-fg-mut">Loading receipt…</p>
      {:else if errorText}
        <p class="text-sm text-bad">{errorText}</p>
      {:else if run}
        <header class="flex flex-col gap-3 border-b border-line pb-4">
          <div class="flex items-start justify-between gap-3">
            <h3 class="text-xl font-semibold tracking-tight">{run.task_summary}</h3>
            <span class="shrink-0 rounded-full border border-line px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-fg-mut">{run.status}</span>
          </div>
          <div class="grid gap-2 sm:grid-cols-2">
            <div class="rounded-xl border border-line bg-bg p-3">
              <div class="text-[11px] uppercase tracking-[0.18em] text-fg-mut">Run id</div>
              <code class="mt-1 block break-all text-xs text-brand">{run.id}</code>
            </div>
            <div class="rounded-xl border border-line bg-bg p-3">
              <div class="text-[11px] uppercase tracking-[0.18em] text-fg-mut">Created</div>
              <div class="mt-1 font-mono text-xs">{run.created_at}</div>
            </div>
          </div>
        </header>
        <section class="pt-4">
          <div class="flex items-baseline justify-between gap-4">
            <h3 class="text-base font-semibold">Event trail ({events.length})</h3>
            <a class="text-xs text-brand hover:underline" href={`/api/runs/${encodeURIComponent(runId ?? "")}/events`} target="_blank" rel="noreferrer">raw JSON</a>
          </div>
          {#if events.length}
            <ol class="mt-3 space-y-2">
              {#each events as event}
                <li class="rounded-xl border border-line bg-bg p-3">
                  <div class="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                    <code class="text-sm text-brand">{event.type}</code>
                    <time class="font-mono text-[11px] text-fg-mut">{event.ts}</time>
                  </div>
                  <div class="mt-1 text-[11px] text-fg-mut">{event.actor?.id ?? "unknown actor"} · {event.actor?.kind ?? "unknown"} · {event.actor?.mode ?? "unknown"}</div>
                </li>
              {/each}
            </ol>
          {:else}
            <p class="mt-3 text-sm text-fg-mut">No events recorded for this run yet.</p>
          {/if}
        </section>
      {/if}
    </div>
  </dialog>
{/if}

<style>
  .run-receipt-modal {
    position: fixed;
    inset: max(0.5rem, env(safe-area-inset-top)) auto auto 50%;
    /* Bounded height so the body scrolls instead of the whole document. On
     * mobile this collapses to the visual viewport minus safe-area insets. */
    height: min(900px, calc(100dvh - 1rem));
    max-height: calc(100dvh - max(1rem, env(safe-area-inset-top) + env(safe-area-inset-bottom)));
    margin: 0;
    transform: translateX(-50%);
    border-radius: 18px;
    box-shadow: 0 28px 80px rgb(0 0 0 / 0.32), 0 2px 10px rgb(0 0 0 / 0.12);
  }

  .run-receipt-modal[open] {
    display: flex;
    flex-direction: column;
  }

  .run-receipt-modal::backdrop {
    background: rgb(0 0 0 / 0.56);
    backdrop-filter: blur(3px);
  }

  .run-receipt-modal__header {
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

  /* The single scroll container: the receipt body grows to fill the bounded
   * dialog and scrolls internally; the header stays pinned above it. */
  .run-receipt-modal__body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
  }

  .run-receipt-modal__close {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    min-height: 36px;
    min-width: 36px;
    padding: 0 11px;
    color: var(--fg-mut);
    border: 1px solid var(--line);
    border-radius: 7px;
    background: var(--bg);
    font-family: inherit;
    font-size: 16px;
    line-height: 1;
    box-shadow: 0 1px 1px rgb(0 0 0 / 0.05);
    transition: color 120ms, border-color 120ms, background 120ms;
  }

  .run-receipt-modal__close:hover {
    color: var(--fg);
    border-color: color-mix(in srgb, var(--fg-mut) 55%, var(--line));
    background: var(--surface-2);
  }
</style>
