<script lang="ts">
  // 1:1 port of src/views/ComputerHealthSection.tsx + the chat.js
  // refreshHealth() block. Owns its own /api/system fetch, state, and
  // refresh button — no element-id contracts with chat.js.
  //
  // Identical visual output to the JSX version. Same Tailwind classes,
  // same icon SVG. Anything that diverges is a bug.

  import { onMount } from "svelte";

  type Sys = {
    region?: string | null;
    country?: string | null;
    container?: { vcpus?: number; memoryGiB?: number; storageGB?: number };
    home?: { diskUsedBytes?: number | null; fileCount?: number | null };
    worker?: { versionId?: string | null; versionTimestamp?: string | null };
  };

  let sys = $state<Sys | null>(null);
  let loading = $state(true);

  function formatBytes(n: number | null | undefined): string {
    if (n == null) return "—";
    if (n < 1024) return n + " B";
    const u = ["KB", "MB", "GB", "TB"];
    let v = n / 1024;
    let i = 0;
    while (v >= 1024 && i < u.length - 1) {
      v /= 1024;
      i++;
    }
    return (v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.round(v)) + " " + u[i];
  }

  function formatRelativeTime(iso: string | null | undefined): string {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    const diff = Math.max(0, Date.now() - d.getTime());
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    return `${day}d ago`;
  }

  async function refresh() {
    loading = true;
    try {
      const r = await fetch("/api/system", { credentials: "include" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      sys = (d?.result ?? {}) as Sys;
    } catch (err) {
      console.error("ComputerHealth.refresh failed:", err);
    } finally {
      loading = false;
    }
  }

  onMount(refresh);

  const containerCapBytes = $derived((sys?.container?.storageGB ?? 20) * 1024 * 1024 * 1024);
  const diskUsed = $derived(sys?.home?.diskUsedBytes);
  const diskPct = $derived(
    diskUsed == null ? 0 : Math.min(100, Math.max(0.5, (diskUsed / containerCapBytes) * 100)),
  );
  const diskLabel = $derived(formatBytes(diskUsed));
  const fileCount = $derived(
    sys?.home?.fileCount == null ? "—" : sys!.home!.fileCount!.toLocaleString(),
  );
  const processor = $derived(sys?.container?.vcpus ? `${sys.container.vcpus} vCPU` : "—");
  const memory = $derived(sys?.container?.memoryGiB ? `${sys.container.memoryGiB} GiB` : "—");
  const region = $derived(
    sys?.region ? (sys.country ? `${sys.region} · ${sys.country}` : sys.region) : "—",
  );
  const versionId = $derived(sys?.worker?.versionId ?? null);
  const versionLabel = $derived(versionId ? versionId.slice(0, 8) : "—");
  const deployed = $derived(formatRelativeTime(sys?.worker?.versionTimestamp));
</script>

<section
  class="rounded-md bg-bg border border-line px-3 py-3 text-fg"
  aria-label="Workspace container health"
>
  <header class="flex items-start justify-between gap-3 mb-2">
    <div>
      <h3 class="text-[11px] font-semibold text-fg uppercase tracking-wider">
        Workspace container
      </h3>
      <p class="mt-0.5 text-[10px] leading-snug text-fg-mut">Remote runtime for commands, files, and receipts.</p>
    </div>
    <button
      type="button"
      onclick={refresh}
      class="w-6 h-6 rounded flex items-center justify-center text-fg-mut hover:text-fg hover:bg-surface-2 active:bg-surface-3 transition-colors"
      aria-label="Refresh"
      title="Refresh"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="23 4 23 10 17 10" />
        <polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
      </svg>
    </button>
  </header>

  <!-- Disk usage — the headline visualization. -->
  <div class="mb-3">
    <div class="flex items-baseline justify-between mb-1">
      <span class="text-[11px] text-fg-mut">Disk</span>
      <span class="text-[11px] text-fg-mut">
        <span class="text-fg font-mono">{diskLabel}</span>
        <span class="mx-1 text-fg-mut/60">/</span>
        <span class="font-mono">{sys?.container?.storageGB ?? 20} GB</span>
      </span>
    </div>
    <div class="h-2 rounded-full bg-surface-2 overflow-hidden">
      <div
        class="h-full bg-brand transition-all duration-300"
        style="width: {diskPct}%"
      ></div>
    </div>
  </div>

  <!-- Spec rows -->
  <div class="space-y-0">
    {#each [
      { label: "Workspace files", value: fileCount, mono: true },
      { label: "Processor", value: processor,    mono: true },
      { label: "Memory",    value: memory,       mono: true },
      { label: "Region",    value: region,       mono: true },
      { label: "Version",   value: versionLabel, mono: true, title: versionId ?? "" },
      { label: "Deployed",  value: deployed,     mono: false },
    ] as row}
      <div class="flex items-baseline justify-between gap-3 py-1.5 border-b border-line/20 last:border-0">
        <span class="text-[11px] text-fg-mut uppercase tracking-wider flex-shrink-0">{row.label}</span>
        <span
          class={"text-[12px] text-fg text-right truncate min-w-0 " + (row.mono ? "font-mono" : "")}
          title={row.title ?? ""}
        >
          {row.value}
        </span>
      </div>
    {/each}
  </div>

  {#if loading}
    <div class="mt-2 text-[10px] text-fg-mut/70 text-center">Loading…</div>
  {/if}
</section>
