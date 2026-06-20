<script lang="ts">
  import type { ToolResultWidget } from "./tool-result-widgets";

  type DelegationGroup = Extract<ToolResultWidget, { kind: "delegation-group" }>;
  let { group }: { group: DelegationGroup } = $props();

  const stateCopy = {
    pending: { icon: "◷", label: "Pending" },
    completed: { icon: "✓", label: "Completed" },
    error: { icon: "!", label: "Error" },
    interrupted: { icon: "↻", label: "Interrupted" },
    aborted: { icon: "×", label: "Aborted" },
  } as const;

  let completed = $derived(group.runs.filter((run) => run.status === "completed").length);
  let heading = $derived(group.live ? "Live progress" : "Completed snapshot");
</script>

<section class="delegation" data-tool-widget="delegation-group" aria-label="Delegated work">
  <header>
    <div>
      <strong>Delegated work</strong>
      <span class="snapshot">{heading}</span>
    </div>
    <span class="count" aria-label={`${completed} of ${group.runs.length} tasks completed`}>{completed}/{group.runs.length} completed</span>
  </header>

  <div class="runs">
    {#each group.runs as run, index}
      {@const state = stateCopy[run.status]}
      <article data-delegate-status={run.status}>
        <div class="run-heading">
          <strong>{run.label || `Child ${index + 1}`}</strong>
          <span class="state"><span class="state-icon" aria-hidden="true">{state.icon}</span>{state.label}</span>
          {#if run.attempts}<span class="attempts">{run.attempts} {run.attempts === 1 ? "attempt" : "attempts"}</span>{/if}
        </div>
        {#if run.summary}<p class="summary">{run.summary}</p>{:else if run.error}<p class="summary error-copy">{run.error}</p>{:else}<p class="summary muted">No summary returned.</p>{/if}

        <details class="metadata">
          <summary>Run details</summary>
          <dl>
            <div><dt>Status</dt><dd>{state.label}</dd></div>
            {#if run.attempts}<div><dt>Attempts</dt><dd>{run.attempts}</dd></div>{/if}
            {#if run.runId}<div><dt>Run ID</dt><dd><code>{run.runId}</code></dd></div>{/if}
            {#if run.taskFingerprint}<div><dt>Fingerprint</dt><dd><code>{run.taskFingerprint}</code></dd></div>{/if}
          </dl>
          {#if run.error && run.summary}<p class="error-copy">{run.error}</p>{/if}
          {#if run.details}
            <details class="raw">
              <summary>Raw output</summary>
              <pre>{run.details}</pre>
            </details>
          {/if}
        </details>
      </article>
    {/each}
  </div>
</section>

<style>
  .delegation { display: grid; gap: .65rem; min-width: 0; padding: .75rem; border: 1px solid color-mix(in srgb, currentColor 16%, transparent); border-radius: .75rem; background: color-mix(in srgb, currentColor 3%, transparent); }
  header, .run-heading { display: flex; align-items: center; justify-content: space-between; gap: .5rem; flex-wrap: wrap; }
  header > div { display: flex; align-items: baseline; gap: .5rem; flex-wrap: wrap; }
  .snapshot, .attempts, .muted { color: color-mix(in srgb, currentColor 62%, transparent); font-size: .78rem; }
  .count { padding: .15rem .45rem; border-radius: 999px; background: color-mix(in srgb, currentColor 8%, transparent); font-size: .75rem; font-variant-numeric: tabular-nums; }
  .runs { display: grid; gap: .5rem; }
  article { min-width: 0; padding: .6rem; border: 1px solid color-mix(in srgb, currentColor 12%, transparent); border-radius: .55rem; background: color-mix(in srgb, Canvas 92%, transparent); }
  .run-heading { justify-content: flex-start; }
  .state { display: inline-flex; align-items: center; gap: .25rem; font-size: .8rem; font-weight: 600; }
  .state-icon { display: inline-grid; width: 1.1rem; height: 1.1rem; place-items: center; border-radius: 50%; background: color-mix(in srgb, currentColor 10%, transparent); }
  article[data-delegate-status="completed"] .state { color: #168052; }
  article[data-delegate-status="error"] .state, article[data-delegate-status="aborted"] .state, .error-copy { color: #b43b36; }
  article[data-delegate-status="interrupted"] .state { color: #9a6700; }
  .attempts { margin-left: auto; }
  .summary { margin: .45rem 0 0; line-height: 1.45; overflow-wrap: anywhere; white-space: pre-wrap; }
  summary { cursor: pointer; width: fit-content; font-size: .8rem; }
  summary:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; border-radius: 2px; }
  .metadata { margin-top: .5rem; }
  dl { display: grid; gap: .3rem; margin: .5rem 0; font-size: .78rem; }
  dl div { display: grid; grid-template-columns: minmax(4.5rem, auto) minmax(0, 1fr); gap: .5rem; }
  dt { color: color-mix(in srgb, currentColor 62%, transparent); }
  dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
  code { white-space: normal; overflow-wrap: anywhere; }
  .raw { margin-top: .45rem; }
  pre { max-height: 16rem; margin: .4rem 0 0; padding: .55rem; overflow: auto; border-radius: .4rem; background: color-mix(in srgb, currentColor 7%, transparent); font-size: .72rem; white-space: pre-wrap; overflow-wrap: anywhere; }
  @media (max-width: 32rem) { .delegation { padding: .55rem; } .attempts { margin-left: 0; width: 100%; } dl div { grid-template-columns: 1fr; gap: .1rem; } }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; animation: none !important; } }
</style>
