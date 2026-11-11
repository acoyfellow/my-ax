<script lang="ts">
  import { onMount } from "svelte";
  import { countLabel, formatTokens, loadTokenUsage, type TokenUsageState } from "./token-usage";

  let usage = $state<TokenUsageState>({ kind: "loading" });

  async function refresh() {
    usage = await loadTokenUsage(fetch);
  }

  onMount(() => {
    void refresh();
    const onOpen = () => void refresh();
    window.addEventListener("my-ax:settings-open", onOpen);
    return () => window.removeEventListener("my-ax:settings-open", onOpen);
  });
</script>

<section class="rounded-md border border-line bg-bg p-3" data-token-usage aria-labelledby="token-usage-title">
  <h3 id="token-usage-title" class="text-xs font-medium text-fg-mut mb-2">Token usage</h3>
  {#if usage.kind === "loading"}
    <p class="text-xs text-fg-mut" data-token-usage-loading>Loading…</p>
  {:else if usage.kind === "error"}
    <p class="text-xs text-red-500" role="status" data-token-usage-error>{usage.message}</p>
  {:else}
    <dl class="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <div><dt class="text-[11px] text-fg-mut">Today</dt><dd class="text-sm font-mono text-fg" data-token-usage-today>{formatTokens(usage.summary.todayTokens)}</dd></div>
      <div><dt class="text-[11px] text-fg-mut">Last {usage.summary.windowDays} days</dt><dd class="text-sm font-mono text-fg" data-token-usage-week>{formatTokens(usage.summary.weekTokens)}</dd></div>
      <div><dt class="text-[11px] text-fg-mut">Cycles</dt><dd class="text-sm font-mono text-fg" data-token-usage-cycles>{formatTokens(usage.summary.cycles)}</dd></div>
      <div><dt class="text-[11px] text-fg-mut">Sessions</dt><dd class="text-sm font-mono text-fg" data-token-usage-sessions>{formatTokens(usage.summary.sessions)}</dd></div>
    </dl>
    {#if usage.summary.models.length > 0}
      <ul class="mt-3 space-y-1" data-token-usage-models>
        {#each usage.summary.models as model (model.model ?? "")}
          <li class="flex items-baseline justify-between gap-3 text-xs">
            <span class="truncate text-fg" title={model.model ?? ""}>{model.label}</span>
            <span class="font-mono text-fg-mut whitespace-nowrap">{countLabel(model.tokens, "token", "tokens")} · {countLabel(model.cycles, "cycle", "cycles")}</span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="mt-2 text-xs text-fg-mut">No model usage in the last {usage.summary.windowDays} days.</p>
    {/if}
  {/if}
</section>
