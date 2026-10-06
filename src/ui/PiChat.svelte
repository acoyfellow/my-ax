<script lang="ts">
  import { onMount } from "svelte";
  import { marked } from "marked";
  import { buildPiRows, composerAction, type PiLiveView, type PiRow } from "./pi-chat-view";

  interface Props { chatId: string }
  const { chatId }: Props = $props();

  type ModelChoice = { provider: string; id: string; label: string };

  let view = $state<PiLiveView | null>(null);
  let rows = $state<PiRow[]>([]);
  let text = $state("");
  let error = $state("");
  let sending = $state(false);
  let stopping = $state(false);
  let models = $state<ModelChoice[]>([]);
  let scrollEl = $state<HTMLDivElement | null>(null);
  let inputEl = $state<HTMLTextAreaElement | null>(null);
  let pinnedToBottom = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const busy = $derived(view?.busy === true);
  const action = $derived(composerAction(busy));
  const currentModel = $derived(models.find((model) => model.id === view?.model)?.label ?? view?.model ?? "");

  const api = (path: string) => `/api/pi/chats/${encodeURIComponent(chatId)}${path}`;

  function render(md: string): string {
    return marked.parse(md ?? "", { gfm: true, breaks: true }) as string;
  }

  async function refresh() {
    try {
      const response = await fetch(api("/live"), { credentials: "include" });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`);
      view = body.result as PiLiveView;
      rows = buildPiRows(view);
      error = "";
      queueMicrotask(scrollIfPinned);
    } catch (err) {
      error = `Could not load this chat: ${err instanceof Error ? err.message : String(err)}. Retrying.`;
    }
  }

  function schedule() {
    if (disposed) return;
    timer = setTimeout(async () => {
      await refresh();
      schedule();
    }, busy || sending ? 700 : 4000);
  }

  function scrollIfPinned() {
    if (scrollEl && pinnedToBottom) scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  function onScroll() {
    if (!scrollEl) return;
    pinnedToBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 80;
  }

  async function send(event?: Event) {
    event?.preventDefault();
    const message = text.trim();
    if (!message || sending) return;
    sending = true;
    const operationId = crypto.randomUUID();
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const response = await fetch(api("/messages"), {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: message, operationId }),
        }).catch(() => null);
        if (response?.ok) {
          text = "";
          pinnedToBottom = true;
          error = "";
          await refresh();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
      }
      error = "Message not sent. It is still in the box; press Send to retry.";
    } finally {
      sending = false;
      inputEl?.focus();
    }
  }

  async function stop() {
    stopping = true;
    try {
      await fetch(api("/abort"), { method: "POST", credentials: "include" });
      await refresh();
    } finally {
      stopping = false;
    }
  }

  async function chooseModel(event: Event) {
    const id = (event.currentTarget as HTMLSelectElement).value;
    const choice = models.find((model) => model.id === id);
    if (!choice) return;
    await fetch(api("/model"), {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: choice.provider, id: choice.id }),
    });
    await refresh();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) void send(event);
  }

  onMount(() => {
    void refresh().then(schedule);
    void fetch("/api/pi/models", { credentials: "include" })
      .then((response) => response.json())
      .then((body) => { models = body?.result?.models ?? []; })
      .catch(() => {});
    inputEl?.focus();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  });
</script>

<div class="pi-chat h-full flex flex-col min-h-0" data-engine="pi" data-chat-id={chatId} data-busy={busy ? "1" : "0"}>
  <div bind:this={scrollEl} onscroll={onScroll} class="flex-1 min-h-0 overflow-y-auto">
    <div class="w-full max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 py-4 flex flex-col gap-3">
      {#if view && rows.length === 0}
        <div class="text-fg-mut text-sm py-10 text-center">New chat on the Pi engine. Its own computer, no step limit.</div>
      {/if}
      {#each rows as row (row.key)}
        {#if row.kind === "user"}
          <div class="pi-row pi-row--user self-end max-w-[85%] rounded-lg bg-surface-2 px-3.5 py-2.5 text-sm whitespace-pre-wrap break-words" data-role="user">{row.text}</div>
        {:else if row.kind === "error"}
          <div class="pi-row pi-row--error rounded-lg border border-bad/40 bg-bad/10 px-3.5 py-2.5 text-sm text-bad" role="alert" data-role="error">{row.text}</div>
        {:else}
          <div class="pi-row pi-row--assistant flex flex-col gap-2" data-role="assistant" data-streaming={row.streaming ? "1" : "0"}>
            {#if row.thinking}
              <details class="text-xs text-fg-mut"><summary class="cursor-pointer">Thinking</summary><div class="whitespace-pre-wrap mt-1">{row.thinking}</div></details>
            {/if}
            {#each row.tools as tool (tool.id)}
              <details class="pi-tool rounded-md border border-line bg-bg px-3 py-1.5 text-xs font-mono" data-tool={tool.name} data-done={tool.done ? "1" : "0"}>
                <summary class="cursor-pointer truncate {tool.isError ? 'text-bad' : 'text-fg-mut'}">{tool.done ? "✓" : "…"} {tool.name} {tool.summary}</summary>
                {#if tool.output}<pre class="mt-1 max-h-64 overflow-auto whitespace-pre-wrap">{tool.output}</pre>{/if}
              </details>
            {/each}
            {#if row.text}
              <div class="prose prose-invert prose-sm max-w-none min-w-0 break-words [overflow-wrap:anywhere] [&_pre]:max-w-full [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto">{@html render(row.text)}</div>
            {/if}
          </div>
        {/if}
      {/each}
      {#if busy && !view?.partial}
        <div class="pi-working text-xs text-fg-mut" aria-live="polite">Working…</div>
      {/if}
      {#if view?.retry}
        <div class="text-xs text-warn">Model error, retrying: {view.retry.error}</div>
      {/if}
    </div>
  </div>

  {#if error}
    <div class="w-full max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 text-xs text-bad" role="alert">{error}</div>
  {/if}

  <div class="flex-none border-t border-line bg-bg-alt">
    <form onsubmit={send} class="safe-area-composer w-full max-w-5xl mx-auto flex gap-2 items-end px-3 sm:px-6 lg:px-8 py-2.5 sm:py-3" autocomplete="off">
      <div class="flex-1 min-w-0 flex flex-col gap-1">
        <textarea
          bind:this={inputEl}
          bind:value={text}
          onkeydown={onKeydown}
          rows={2}
          placeholder={busy ? "Agent is working. Your message joins the queue." : "Message"}
          class="w-full resize-none rounded-lg bg-bg border border-line text-fg placeholder:text-fg-mut/70 px-3.5 py-2.5 text-base sm:text-sm leading-snug focus:outline-none focus:border-brand/60 focus:ring-1 focus:ring-brand/40 min-h-[44px] max-h-40"
          aria-label="Message"
        ></textarea>
        <div class="flex items-center gap-2 text-[11px] text-fg-mut">
          {#if models.length}
            <select class="pi-model bg-transparent border border-line rounded px-1 py-0.5" aria-label="Model" value={view?.model ?? ""} onchange={chooseModel}>
              {#each models as model (model.id)}<option value={model.id}>{model.label}</option>{/each}
            </select>
          {:else}
            <span class="pi-model-label">{currentModel}</span>
          {/if}
          {#if view?.queued}<span>{view.queued} queued</span>{/if}
          <span class="ml-auto">Pi engine</span>
        </div>
      </div>
      {#if busy}
        <button type="button" onclick={stop} disabled={stopping} class="pi-stop flex-none rounded-lg border border-line bg-bg text-fg px-3 h-11 text-sm font-medium hover:border-bad/60 hover:text-bad disabled:opacity-50" aria-label="Stop">Stop</button>
      {/if}
      <button type="submit" disabled={!text.trim() || sending} class="pi-send flex-none rounded-lg bg-brand text-white px-4 h-11 text-sm font-semibold disabled:opacity-40" aria-label={action === "queue" ? "Queue message" : "Send"}>{action === "queue" ? "Queue" : "Send"}</button>
    </form>
  </div>
</div>
