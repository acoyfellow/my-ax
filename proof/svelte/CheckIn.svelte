<script lang="ts">
  import { onMount } from "svelte";

  type Steer = { label: string; href: string };
  type Bucket = { key: string; label: string; total: number; sampleCount: number; sampleIds?: string[]; steer: Steer | null };
  type CheckIn = { summary: string; buckets?: Bucket[]; suggestedSteers?: Steer[]; deployment?: { versionId?: string | null } };

  let checkIn = $state<CheckIn | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(true);

  async function refresh() {
    loading = true;
    error = null;
    try {
      const response = await fetch("/api/check-in", { credentials: "include" });
      const data = await response.json().catch(() => null) as { ok?: boolean; result?: CheckIn; error?: { message?: string } } | null;
      if (!response.ok || !data?.ok || !data.result) throw new Error(data?.error?.message || "Could not load Check-in");
      checkIn = data.result;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void refresh();
    const handler = () => void refresh();
    window.addEventListener("my-ax:check-in-refresh", handler);
    return () => window.removeEventListener("my-ax:check-in-refresh", handler);
  });
</script>

<section class="check-in-strip border-b border-line bg-bg/85 px-3 py-2 text-fg sm:px-4" aria-label="Owner Check-in" data-check-in-root>
  <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
    <div class="min-w-0">
      <div class="flex items-center gap-2">
        <span class="rounded-full border border-line px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-fg-mut">Check-in</span>
        {#if loading}
          <span class="text-xs text-fg-mut">loading…</span>
        {:else if error}
          <button type="button" onclick={refresh} class="text-xs text-bad hover:underline">{error}</button>
        {:else if checkIn}
          <p class="truncate text-sm font-medium text-fg">{checkIn.summary}</p>
        {/if}
      </div>
    </div>
    {#if checkIn?.buckets?.length}
      <div class="flex gap-1.5 overflow-x-auto pb-0.5 sm:justify-end" aria-label="Check-in buckets">
        {#each checkIn.buckets as bucket (bucket.key)}
          {@const content = `${bucket.label}: ${bucket.total} total, ${bucket.sampleCount} shown`}
          {#if bucket.steer}
            <a class="inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-bg-alt px-2.5 py-1 text-[11px] text-fg-mut hover:border-brand/50 hover:text-fg" href={bucket.steer.href} title={content} data-check-in-bucket={bucket.key}>
              <span>{bucket.label}</span><strong class="text-fg">{bucket.total}</strong>
            </a>
          {:else}
            <span class="inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-bg-alt px-2.5 py-1 text-[11px] text-fg-mut" title={content} data-check-in-bucket={bucket.key}>
              <span>{bucket.label}</span><strong class="text-fg">{bucket.total}</strong>
            </span>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
</section>
