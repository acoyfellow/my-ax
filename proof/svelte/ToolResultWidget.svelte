<script lang="ts">
  import DelegationGroup from "./DelegationGroup.svelte";
  import { resolveToolResultWidget } from "./tool-result-widgets";

  let { result, toolName = "tool" }: { result: unknown; toolName?: string } = $props();
  let widget = $derived(resolveToolResultWidget(result, toolName));
  let fullscreen = $state(false);
  let reusableToolAction = $state<"idle" | "approving" | "enabled" | "error">("idle");
  let reusableToolMessage = $state("");

  function openFullscreen() {
    fullscreen = true;
  }

  function closeFullscreen() {
    fullscreen = false;
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && fullscreen) closeFullscreen();
  }

  function openReusableTools(recipeName: string) {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("my-ax:settings-open", {
      detail: { section: "recipes", recipeName },
    }));
  }

  async function approveReusableTool(recipeName: string, sourceCode: string) {
    if (reusableToolAction === "approving" || reusableToolAction === "enabled") return;
    reusableToolAction = "approving";
    reusableToolMessage = "Enabling reusable tool…";
    try {
      const response = await fetch("/api/recipes/by-name/approval", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: recipeName, sourceCode, action: "approve" }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message || "Could not enable this reusable tool.");
      reusableToolAction = "enabled";
      reusableToolMessage = "Enabled. My AX can now use this reusable tool in future tasks.";
    } catch (error) {
      reusableToolAction = "error";
      reusableToolMessage = error instanceof Error ? error.message : "Could not enable this reusable tool.";
    }
  }

  // Lock body scroll while fullscreen so mobile can't get stuck behind the artifact.
  $effect(() => {
    if (typeof document === "undefined") return;
    const prev = document.body.style.overflow;
    if (fullscreen) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  });
</script>

<svelte:window onkeydown={onKeydown} />

{#if widget.kind === "delegation-group"}
  <DelegationGroup group={widget} />
{:else if widget.kind === "svelte-artifact"}
  <section class="svelte-artifact-shell" data-fullscreen={fullscreen ? "1" : "0"}>
    <div class="tool-call__result tool-call__browser-summary" data-tool-widget="svelte-artifact">
      <strong>{widget.title}</strong>
      <span>Interactive artifact</span>
    </div>
    <div class="svelte-artifact-stage">
      {#if fullscreen}
        <!-- Mobile-friendly, always-visible exit affordance: large labelled button, never hidden behind iframe focus. -->
        <button
          type="button"
          class="svelte-artifact-exit"
          aria-label="Exit fullscreen artifact"
          title="Exit fullscreen (Esc)"
          onclick={closeFullscreen}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          <span>Exit</span>
        </button>
      {:else}
        <button
          type="button"
          class="svelte-artifact-fullscreen"
          aria-label="Open artifact fullscreen"
          title="Fullscreen"
          onclick={openFullscreen}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6" /></svg>
        </button>
      {/if}
      <iframe
        class="svelte-artifact-frame"
        src={widget.src}
        title={widget.title}
        loading="lazy"
        sandbox="allow-scripts"
        allow="fullscreen"
        allowfullscreen
        referrerpolicy="no-referrer"
        data-artifact-id={widget.artifactId}
      ></iframe>
    </div>
  </section>
{:else if widget.kind === "audio-message"}
  <section class="tool-call__result audio-message" data-tool-widget="audio-message" data-audio-id={widget.audioId}>
    <div class="audio-message__head">
      <span class="audio-message__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10v4h4l5 5V5L7 10H3z"/><path d="M16 8a5 5 0 0 1 0 8"/></svg>
      </span>
      <div class="audio-message__meta">
        <strong>{widget.title}</strong>
        <span class="audio-message__voice">Voice message · {widget.voice}</span>
      </div>
    </div>
    <audio class="audio-message__player" controls preload="metadata" src={widget.src}></audio>
  </section>
{:else if widget.kind === "browser-run"}
  <div class="tool-call__result tool-call__browser-summary" data-tool-widget="browser-run">
    <strong>{widget.heading}</strong>
    {#if widget.title}<span>{widget.title}</span>{/if}
    {#if widget.url}<span>{widget.url}</span>{/if}
    {#if widget.text}<span>{widget.text}</span>{/if}
  </div>
  {#if widget.screenshotSrc}
    <img
      class="tool-call__inline-image"
      src={widget.screenshotSrc}
      alt="Browser Run captured view"
      loading="lazy"
      data-tool-widget="browser-run-screenshot"
    />
  {/if}
  {#if widget.replaySrc}
    <iframe
      class="browser-replay-frame"
      src={widget.replaySrc}
      title="Browser Run replay"
      loading="lazy"
      referrerpolicy="no-referrer"
    ></iframe>
  {/if}
{:else if widget.kind === "inline-raster-image"}
  <img class="tool-call__inline-image" src={widget.src} alt={widget.alt} loading="lazy" data-tool-widget="inline-raster-image" />
{:else if widget.kind === "inline-video"}
  <video class="tool-call__inline-video" src={widget.src} controls preload="metadata" playsinline aria-label={widget.label} data-tool-widget="inline-video"></video>
{:else if widget.kind === "reusable-tool-candidate"}
  <section
    class="tool-call__result reusable-tool-candidate"
    data-tool-widget="reusable-tool-candidate"
    data-fingerprint={widget.fingerprint}
  >
    <div class="reusable-tool-candidate__head">
      <strong>Reusable tool</strong>
      <span class="reusable-tool-candidate__name">{widget.proposedName}</span>
    </div>
    {#if widget.approvalMode === "auto"}
      <p class="reusable-tool-candidate__desc">Auto-enable is on. My AX will enable this tool when the response finishes; you can review, disable, or delete it in Reusable tools.</p>
    {:else}
      <p class="reusable-tool-candidate__desc">My AX thinks this code could be useful again. Enable it now, or review the source and permissions first.</p>
    {/if}
    {#if widget.proposedDescription}
      <p class="reusable-tool-candidate__muted">{widget.proposedDescription}</p>
    {/if}
    {#if widget.capabilities.length}
      <div class="reusable-tool-candidate__caps" aria-label="Inferred capabilities">
        {#each widget.capabilities as capability}
          <code>{capability}</code>
        {/each}
      </div>
    {:else}
      <p class="reusable-tool-candidate__muted">No host capabilities were used.</p>
    {/if}
    <details class="reusable-tool-candidate__review">
      <summary>Review source and result</summary>
      <div class="reusable-tool-candidate__source-label" aria-label="Source">{widget.source}</div>
      <pre>{widget.sourceCode}</pre>
      {#if widget.resultPreview}<pre>{widget.resultPreview}</pre>{/if}
    </details>
    <div class="reusable-tool-candidate__actions">
      {#if widget.approvalMode === "review"}
        <button
          type="button"
          class="reusable-tool-candidate__action inline-flex items-center justify-center rounded-md bg-brand text-bg text-sm font-semibold px-4 py-2.5 min-h-[44px] w-full sm:w-auto hover:bg-brand/90 active:bg-brand/80 focus:outline-none focus:ring-2 focus:ring-brand/60 transition-colors disabled:opacity-50"
          aria-label={`Approve and enable reusable tool ${widget.proposedName}`}
          data-tool-widget-action="approve-reusable-tool"
          disabled={reusableToolAction === "approving" || reusableToolAction === "enabled"}
          onclick={() => approveReusableTool(widget.proposedName, widget.sourceCode)}
        >
          {reusableToolAction === "approving" ? "Enabling…" : reusableToolAction === "enabled" ? "Enabled" : "Approve & enable"}
        </button>
      {/if}
      <button
        type="button"
        class="reusable-tool-candidate__secondary inline-flex items-center justify-center rounded-md border border-line bg-bg text-fg text-sm font-semibold px-4 py-2.5 min-h-[44px] w-full sm:w-auto hover:border-brand/60 focus:outline-none focus:ring-2 focus:ring-brand/60 transition-colors"
        aria-label={`Open reusable tool settings for ${widget.proposedName}`}
        data-tool-widget-action="review-reusable-tool"
        onclick={() => openReusableTools(widget.proposedName)}
      >
        Open Reusable tools
      </button>
    </div>
    {#if reusableToolMessage}
      <p class:reusable-tool-candidate__error={reusableToolAction === "error"} class="reusable-tool-candidate__status" role="status" aria-live="polite">{reusableToolMessage}</p>
    {/if}
  </section>
{:else}
  <pre class="tool-call__result" data-tool-widget="raw-text">{widget.text}</pre>
{/if}
