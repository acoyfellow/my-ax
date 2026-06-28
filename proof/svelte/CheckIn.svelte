<script lang="ts">
  import { onMount } from "svelte";
  import { displayCheckInHref } from "./check-in-display-href";

  type Steer = { label: string; href: string };
  type Bucket = { key: string; label: string; total: number; sampleCount: number; sampleIds?: string[]; steer: Steer | null };
  type CheckIn = { summary: string; checkedAt?: string; buckets?: Bucket[]; suggestedSteers?: Steer[]; deployment?: { versionId?: string | null } };

  let checkIn = $state<CheckIn | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(true);
  let expanded = $state(false);

  const DETAILS_STORAGE_KEY = "my-ax:check-in-details-expanded";

  function setExpanded(value: boolean) {
    expanded = value;
    try {
      localStorage.setItem(DETAILS_STORAGE_KEY, value ? "1" : "0");
    } catch {}
  }

  function formatCheckedAt(value?: string): string | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

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
    try {
      expanded = localStorage.getItem(DETAILS_STORAGE_KEY) === "1";
    } catch {}
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
      {#if checkIn?.checkedAt && !loading && !error}
        <p class="mt-1 text-[11px] text-fg-mut" title={checkIn.checkedAt} data-check-in-checked-at>Checked by server {formatCheckedAt(checkIn.checkedAt)}</p>
      {/if}
    </div>
    <div class="flex items-center gap-2 sm:ml-auto">
      <button type="button" onclick={() => setExpanded(!expanded)} class="shrink-0 rounded-full border border-line px-2.5 py-1 text-[11px] font-semibold text-fg-mut hover:border-brand/50 hover:text-fg" aria-expanded={expanded} aria-controls="check-in-details" data-check-in-details-toggle>
        {expanded ? "Hide details" : "Details"}
      </button>
      <button type="button" onclick={refresh} disabled={loading} class="shrink-0 rounded-full border border-line px-2.5 py-1 text-[11px] font-semibold text-fg-mut hover:border-brand/50 hover:text-fg disabled:cursor-wait disabled:opacity-60" aria-label="Refresh Check-in" data-check-in-refresh>
        {loading ? "Refreshing…" : "Refresh"}
      </button>
    {#if checkIn?.buckets?.length}
      <div class="flex gap-1.5 overflow-x-auto pb-0.5 sm:justify-end" aria-label="Check-in buckets">
        {#each checkIn.buckets as bucket (bucket.key)}
          {@const content = `${bucket.label}: ${bucket.total} total, ${bucket.sampleCount} shown`}
          {#if bucket.steer}
            <a class="inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-bg-alt px-2.5 py-1 text-[11px] text-fg-mut hover:border-brand/50 hover:text-fg" href={displayCheckInHref(bucket.steer.href)} title={content} data-check-in-bucket={bucket.key} data-check-in-raw-href={bucket.steer.href}>
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
  </div>
  {#if expanded && checkIn?.buckets?.length}
    <div id="check-in-details" class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5" data-check-in-details>
      {#each checkIn.buckets as bucket (bucket.key)}
        <section class="rounded-xl border border-line bg-bg-alt p-3" data-check-in-detail-bucket={bucket.key}>
          <div class="flex items-start justify-between gap-2">
            <div>
              <h3 class="text-xs font-semibold text-fg">{bucket.label}</h3>
              <p class="mt-1 text-[11px] text-fg-mut">{bucket.sampleCount} shown from {bucket.total} total</p>
            </div>
            <strong class="text-sm text-fg">{bucket.total}</strong>
          </div>
          {#if bucket.sampleIds?.length}
            <p class="mt-2 truncate font-mono text-[10px] text-fg-mut" title={bucket.sampleIds.join(", ")}>{bucket.sampleIds.slice(0, 2).join(", ")}{bucket.sampleIds.length > 2 ? "…" : ""}</p>
          {/if}
          {#if bucket.steer}
            <a class="mt-2 inline-flex text-[11px] font-semibold text-brand hover:underline" href={displayCheckInHref(bucket.steer.href)} data-check-in-raw-href={bucket.steer.href}>{bucket.steer.label}</a>
          {/if}
        </section>
      {/each}
    </div>
  {/if}
</section>
