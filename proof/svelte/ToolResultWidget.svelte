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
{:else}
  <pre class="tool-call__result" data-tool-widget="raw-text">{widget.text}</pre>
{/if}
