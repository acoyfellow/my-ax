<script lang="ts">
  import { onMount } from "svelte";
  import { canDismiss, dismissDecisionOnServer, viewAfterAnswer, viewAfterDismiss, viewFromState, type DecisionView } from "./decision-widget";

  let { decisionId, options: initialOptions }: { decisionId: string; options: string[] } = $props();
  let view = $state<DecisionView>({ phase: "loading" });

  async function load() {
    try {
      const response = await fetch(`/api/decisions/${encodeURIComponent(decisionId)}/state`, { credentials: "include" });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.result) throw new Error(body?.error?.message || "Could not load this decision.");
      view = viewFromState(body.result);
    } catch (error) {
      view = { phase: "error", message: error instanceof Error ? error.message : "Could not load this decision.", question: null, options: initialOptions };
    }
  }

  async function choose(choice: string) {
    if (view.phase !== "open" && view.phase !== "error") return;
    const question = view.question ?? "";
    const options = view.options;
    view = { phase: "sending", question, options, choice };
    try {
      const response = await fetch(`/api/decisions/${encodeURIComponent(decisionId)}/respond`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ choice }),
      });
      const body = await response.json().catch(() => null);
      view = viewAfterAnswer({ phase: "open", question, options }, choice, response.status, body?.error?.message ?? null);
      if (view.phase === "answered") window.dispatchEvent(new CustomEvent("my-ax:decision-answered", { detail: { decisionId } }));
      if (response.status === 409) await load();
    } catch {
      view = viewAfterAnswer({ phase: "open", question, options }, choice, 0, null);
    }
  }

  async function dismiss() {
    if (!canDismiss(view)) return;
    const before = view;
    try {
      view = viewAfterDismiss(before, await dismissDecisionOnServer(decisionId, fetch));
      if (view.phase === "dismissed") window.dispatchEvent(new CustomEvent("my-ax:decision-answered", { detail: { decisionId } }));
      else await load();
    } catch {
      view = before;
    }
  }

  function when(iso: string | null): string {
    if (!iso) return "";
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
  }

  onMount(() => {
    void load();
    const onFocus = (event: Event) => {
      if ((event as CustomEvent<{ decisionId?: string }>).detail?.decisionId === decisionId) void load();
    };
    window.addEventListener("my-ax:decision-focus", onFocus);
    return () => window.removeEventListener("my-ax:decision-focus", onFocus);
  });
</script>

<section class="decision" data-decision-id={decisionId} data-decision-phase={view.phase} aria-live="polite">
  {#if view.phase === "loading"}
    <p class="decision__note">Loading decision…</p>
  {:else}
    {#if "question" in view && view.question}
      <div class="decision__head">
        <p class="decision__question">{view.question}</p>
        {#if canDismiss(view)}
          <button type="button" class="decision__dismiss" aria-label="Dismiss question" title="Dismiss" data-decision-dismiss onclick={dismiss}>×</button>
        {/if}
      </div>
    {/if}
    {#if view.phase === "open" || view.phase === "sending" || view.phase === "error"}
      <div class="decision__options" role="group" aria-label="Choose an answer">
        {#each view.options as option (option)}
          <button
            type="button"
            class="decision__option"
            data-selected={view.phase === "sending" && view.choice === option ? "1" : undefined}
            disabled={view.phase === "sending"}
            onclick={() => choose(option)}
          >{option}</button>
        {/each}
      </div>
      {#if view.phase === "sending"}<p class="decision__note">Sending…</p>{/if}
      {#if view.phase === "error"}<p class="decision__note decision__note--bad">{view.message}</p>{/if}
    {:else if view.phase === "answered"}
      <div class="decision__options" aria-label="Answered">
        {#each view.options as option (option)}
          <span class="decision__option decision__option--frozen" data-chosen={option === view.choice ? "1" : undefined}>{option === view.choice ? "✓ " : ""}{option}</span>
        {/each}
      </div>
      <p class="decision__note">{view.choice ? `You chose ${view.choice}` : "Already answered"}{view.answeredAt ? ` · ${when(view.answeredAt)}` : ""}</p>
    {:else if view.phase === "dismissed"}
      <p class="decision__note">Dismissed.</p>
    {:else if view.phase === "replaced"}
      <p class="decision__note">Replaced by a newer question further down.</p>
    {/if}
  {/if}
</section>

<style>
  .decision { display: grid; gap: 10px; margin: 8px 0 4px; padding: 14px; border: 1px solid color-mix(in srgb, var(--brand) 40%, var(--line)); border-radius: 12px; background: color-mix(in srgb, var(--brand) 6%, var(--bg-alt)); min-width: 0; max-width: 100%; }
  .decision__head { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
  .decision__head .decision__question { flex: 1; min-width: 0; }
  .decision__dismiss { flex: none; width: 28px; height: 28px; margin: -4px -4px 0 0; display: grid; place-items: center; border: 0; border-radius: 7px; background: transparent; color: var(--fg-mut); font-size: 18px; line-height: 1; cursor: pointer; }
  .decision__dismiss:hover { color: var(--fg); background: color-mix(in srgb, var(--fg) 8%, transparent); }
  .decision[data-decision-phase="answered"], .decision[data-decision-phase="replaced"], .decision[data-decision-phase="dismissed"] { border-color: var(--line); background: var(--bg-alt); }
  .decision__question { margin: 0; font-weight: 600; color: var(--fg); line-height: 1.4; overflow-wrap: anywhere; }
  .decision__options { display: flex; flex-wrap: wrap; gap: 8px; min-width: 0; }
  .decision__option { min-height: 44px; max-width: 100%; padding: 10px 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); color: var(--fg); font-size: 14px; font-weight: 600; text-align: left; overflow-wrap: anywhere; cursor: pointer; }
  .decision__option:hover:not(:disabled) { border-color: var(--brand); }
  .decision__option:disabled { opacity: 0.6; cursor: default; }
  .decision__option[data-selected="1"] { border-color: var(--brand); }
  .decision__option--frozen { cursor: default; opacity: 0.55; display: inline-flex; align-items: center; }
  .decision__option--frozen[data-chosen="1"] { opacity: 1; border-color: var(--brand); background: color-mix(in srgb, var(--brand) 12%, var(--bg)); }
  .decision__note { margin: 0; font-size: 13px; color: var(--fg-mut); }
  .decision__note--bad { color: var(--bad, #d33); }
  :global(.decision-focus) { animation: decision-focus 1.6s ease-out 1; }
  @keyframes decision-focus { 0% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 60%, transparent); } 100% { box-shadow: 0 0 0 0 transparent; } }
  @media (prefers-reduced-motion: reduce) { :global(.decision-focus) { animation: none; } }
</style>
