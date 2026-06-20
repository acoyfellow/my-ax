<script lang="ts">
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
</script>

<svelte:window onkeydown={onKeydown} />

{#if widget.kind === "delegation-group"}
  <section class="tool-call__result" data-tool-widget="delegation-group" aria-label="Delegation results">
    <strong>Delegated work</strong>
    <small>Completed snapshot</small>
    {#each widget.runs as run, index}
      <article data-delegate-status={run.status}>
        <div><strong>Child {index + 1}</strong> · <span>{run.status}</span>{#if run.attempts} · <span>{run.attempts} {run.attempts === 1 ? "attempt" : "attempts"}</span>{/if}</div>
        {#if run.summary}<p>{run.summary}</p>{:else if run.error}<p>{run.error}</p>{/if}
        {#if run.details || (run.error && run.summary)}
          <details>
            <summary>Details</summary>
            {#if run.error}<p>{run.error}</p>{/if}
            {#if run.details}<pre>{run.details}</pre>{/if}
          </details>
        {/if}
      </article>
    {/each}
  </section>
{:else if widget.kind === "svelte-artifact"}
  <section class="svelte-artifact-shell" data-fullscreen={fullscreen ? "1" : "0"}>
    <div class="tool-call__result tool-call__browser-summary" data-tool-widget="svelte-artifact">
      <strong>{widget.title}</strong>
      <span>Interactive artifact</span>
    </div>
    <div class="svelte-artifact-stage">
      <button
        type="button"
        class="svelte-artifact-fullscreen"
        aria-label={fullscreen ? "Exit fullscreen artifact" : "Open artifact fullscreen"}
        title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
        onclick={fullscreen ? closeFullscreen : openFullscreen}
      >
        {#if fullscreen}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" /></svg>
        {:else}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6" /></svg>
        {/if}
      </button>
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
