<script lang="ts">
  import DelegationGroup from "./DelegationGroup.svelte";
  import { resolveToolResultWidget } from "./tool-result-widgets";

  let { result, toolName = "tool" }: { result: unknown; toolName?: string } = $props();
  let widget = $derived(resolveToolResultWidget(result, toolName));
  let fullscreen = $state(false);

  function openFullscreen() {
    fullscreen = true;
  }

  function closeFullscreen() {
    fullscreen = false;
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && fullscreen) closeFullscreen();
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
    {#if widget.proposedDescription}
      <p class="reusable-tool-candidate__desc">{widget.proposedDescription}</p>
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
    <!--
      No API write or auto-enable in the chat surface: the button only hands off
      to Settings, where the owner can inspect, edit, and enable the reusable
      tool themselves. The dispatched CustomEvent detail carries the proposed
      name so Settings can scroll to it.
    -->
    <button
      type="button"
      class="reusable-tool-candidate__action inline-flex items-center justify-center rounded-md bg-brand text-bg text-sm font-semibold px-4 py-2.5 min-h-[44px] w-full sm:w-auto hover:bg-brand/90 active:bg-brand/80 focus:outline-none focus:ring-2 focus:ring-brand/60 transition-colors"
      aria-label={`Review reusable tool ${widget.proposedName}`}
      data-tool-widget-action="review-reusable-tool"
      onclick={() => {
        if (typeof window === "undefined") return;
        window.dispatchEvent(new CustomEvent("my-ax:settings-open", {
          detail: { section: "recipes", recipeName: widget.proposedName },
        }));
      }}
    >
      Review reusable tool
    </button>
  </section>
{:else}
  <pre class="tool-call__result" data-tool-widget="raw-text">{widget.text}</pre>
{/if}
