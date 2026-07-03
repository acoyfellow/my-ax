<script lang="ts">
  import { onMount } from "svelte";
  import { displayCheckInHref } from "./check-in-display-href";

  type Steer = { label: string; href: string };
  type Bucket = { key: string; label: string; total: number; sampleCount: number; sampleIds?: string[]; steer: Steer | null };
  type CheckIn = { summary: string; checkedAt?: string; buckets?: Bucket[]; suggestedSteers?: Steer[]; deployment?: { versionId?: string | null } };

  interface Props { embedded?: boolean }
  const { embedded = false }: Props = $props();

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

  // Actionable attention outranks informational updates; informational sits above completedRuns.
  const BUCKET_PRIORITY = ["failedRuns", "attention", "openRuns", "activeJobs", "informationalAttention", "completedRuns"];

  function primaryBucket(buckets?: Bucket[]): Bucket | null {
    const actionable = (buckets ?? []).filter((bucket) => bucket.total > 0 && bucket.steer);
    actionable.sort((a, b) => BUCKET_PRIORITY.indexOf(a.key) - BUCKET_PRIORITY.indexOf(b.key));
    return actionable[0] ?? null;
  }

  function formatCheckedAt(value?: string): string | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function checkedAtLabel(prefix: string, value?: string): string | null {
    const formatted = formatCheckedAt(value);
    return formatted ? `${prefix} ${formatted}` : null;
  }

  function shortVersion(value?: string | null): string | null {
    if (!value) return null;
    return value.length > 12 ? value.slice(0, 8) : value;
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

<section class="check-in-card @container/checkin bg-bg px-4 py-4 text-fg" aria-label="Owner Check-in" data-check-in-root>
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0">
      <p class="text-[10px] font-bold uppercase tracking-[0.16em] text-fg-mut">Owner status</p>
      {#if loading}
        <p class="mt-2 text-sm text-fg-mut">Loading latest state…</p>
      {:else if error}
        <button type="button" onclick={refresh} class="mt-2 text-left text-sm text-bad hover:underline">Could not refresh Check-in: {error}</button>
        {#if checkIn}
          <p class="mt-2 text-sm leading-snug text-fg-mut">Showing stale Check-in: {checkIn.summary}</p>
        {/if}
      {:else if checkIn}
        <p class="mt-2 text-xl font-semibold leading-tight text-fg @min-[24rem]/checkin:text-2xl">{checkIn.summary}</p>
      {/if}
      {#if checkIn?.checkedAt && !loading}
        <p class="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-mut" title={checkIn.checkedAt} data-check-in-checked-at>
          <span>{error ? checkedAtLabel("Stale since", checkIn.checkedAt) : checkedAtLabel("Checked", checkIn.checkedAt)}</span>
          {#if shortVersion(checkIn.deployment?.versionId)}
            <code class="rounded-full border border-line bg-bg px-1.5 py-0.5 text-[10px] text-fg-mut" title={checkIn.deployment?.versionId} data-check-in-version>v{shortVersion(checkIn.deployment?.versionId)}</code>
          {/if}
        </p>
      {/if}
    </div>
    <button type="button" onclick={refresh} disabled={loading} class="shrink-0 rounded-full border border-line px-2.5 py-1 text-[11px] font-semibold text-fg-mut hover:border-brand/50 hover:text-fg disabled:cursor-wait disabled:opacity-60" aria-label="Refresh Check-in" data-check-in-refresh>
      {loading ? "…" : "Refresh"}
    </button>
  </div>

  {#if checkIn?.buckets?.length}
    {@const primary = primaryBucket(checkIn.buckets)}
    {#if primary?.steer}
      <a class="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-brand/30 bg-brand/10 px-4 py-3 text-sm font-semibold text-brand hover:border-brand/60" href={displayCheckInHref(primary.steer.href)} data-check-in-raw-href={primary.steer.href}>
        <span>{primary.steer.label}</span>
        <span aria-hidden="true">→</span>
      </a>
    {/if}

    {#if !embedded}
      <button type="button" onclick={() => setExpanded(!expanded)} class="mt-3 text-[11px] font-semibold text-brand hover:underline" aria-expanded={expanded} aria-controls="check-in-details" data-check-in-details-toggle>
        {expanded ? "Hide receipt details" : "Show all receipt details"}
      </button>
    {/if}
  {/if}

  {#if !embedded && expanded && checkIn?.buckets?.length}
    <div id="check-in-details" class="mt-3 grid gap-1.5" data-check-in-details>
      {#each checkIn.buckets as bucket (bucket.key)}
        <section class="rounded-xl border border-line bg-bg-alt p-3" data-check-in-detail-bucket={bucket.key} data-check-in-bucket={bucket.key}>
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <h3 class="truncate text-xs font-semibold text-fg">{bucket.label}</h3>
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

