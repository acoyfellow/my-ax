<script lang="ts">
  import type { SeismoBar, SeismoPulse } from "../seismograph";

  interface Props {
    pulse?: SeismoPulse | null;
    running?: boolean;
    blocked?: boolean;
    size?: "small" | "medium" | "large";
  }

  const { pulse = null, running = false, blocked = false, size = "small" }: Props = $props();

  const SLOTS = 16;

  let hoveredIdx = $state<number | null>(null);

  let slots = $derived.by(() => {
    const raw = pulse?.bars ?? [];
    const trimmed = raw.slice(-SLOTS);
    const pad = Math.max(0, SLOTS - trimmed.length);
    const out: Array<SeismoBar | null> = [];
    for (let i = 0; i < pad; i++) out.push(null);
    for (const b of trimmed) out.push(b);
    return out;
  });

  let isBlocked = $derived(blocked || Boolean(pulse?.blocked));

  const KIND_LABELS: Record<string, string> = {
    llm: "model",
    box: "sandbox",
    mac: "Mac",
    web: "web",
    err: "error",
    wait: "needs input",
  };

  let summary = $derived.by(() => {
    const bars = pulse?.bars ?? [];
    if (!bars.length) return isBlocked ? "Waiting on your input" : "No recent activity";
    const counts = new Map<string, number>();
    for (const bar of bars) counts.set(bar.k, (counts.get(bar.k) ?? 0) + 1);
    const parts = [...counts.entries()].map(([k, n]) => `${n} ${KIND_LABELS[k] ?? k}`);
    return `${isBlocked ? "Needs input · " : ""}Recent: ${parts.join(" · ")}`;
  });

  function formatDuration(ms: number | undefined): string {
    if (!ms || ms <= 0) return "";
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  }

  function formatAgo(ts: number | undefined): string {
    if (!ts || ts <= 0) return "";
    const diff = Math.max(0, Date.now() - ts);
    if (diff < 60_000) return "now";
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  }

  function barDetail(bar: SeismoBar): string {
    const label = bar.l || KIND_LABELS[bar.k] || bar.k;
    const parts = [label];
    if (bar.o) parts.push(`${bar.o} tok`);
    const dur = formatDuration(bar.d);
    if (dur) parts.push(dur);
    const ago = formatAgo(bar.t);
    if (ago) parts.push(ago);
    return parts.join(" · ");
  }

  let hoveredBar = $derived(hoveredIdx !== null ? slots[hoveredIdx] ?? null : null);

  function barHeight(bar: SeismoBar | null): number {
    if (!bar) return 2;
    return Math.max(4, Math.round((bar.v / 100) * 28));
  }
</script>

<div class="seismo-wrap" data-hovering={hoveredBar ? "1" : "0"} onmouseleave={() => { hoveredIdx = null; }}>
  {#if hoveredBar}
    <div class="seismo-tip" data-kind={hoveredBar.k} data-seismo-tip role="status">
      <span class="seismo-tip__dot" data-kind={hoveredBar.k}></span>
      <span class="seismo-tip__text">{barDetail(hoveredBar)}</span>
    </div>
  {/if}
  <svg
    class="seismo"
    class:seismo--running={running}
    class:seismo--blocked={isBlocked}
    class:seismo--inspecting={hoveredBar !== null}
    data-size={size}
    viewBox="0 0 160 32"
    preserveAspectRatio="none"
    role="img"
    aria-label={summary}
  >
    <title>{summary}</title>
    <line class="seismo__base" x1="0" y1="31" x2="160" y2="31" />
    {#if isBlocked}
      <line class="seismo__crack" x1="0" y1="16" x2="160" y2="16" />
    {/if}
    {#each slots as bar, i (i)}
      {@const h = barHeight(bar)}
      {@const active = hoveredIdx === i && bar !== null}
      <g
        class="seismo__slot"
        onmouseenter={() => { hoveredIdx = bar ? i : null; }}
      >
        <rect class="seismo__hit" x={i * 10} y="0" width="10" height="32" />
        <rect
          class="seismo__bar"
          class:seismo__bar--live={running && i >= SLOTS - 3}
          class:seismo__bar--active={active}
          data-kind={bar ? bar.k : "empty"}
          x={i * 10 + 1.5}
          y={31 - h}
          width="7"
          height={h}
          rx="1.5"
        />
      </g>
    {/each}
  </svg>
</div>

<style>
  .seismo-wrap {
    position: relative;
    display: block;
    width: 100%;
  }
  .seismo-tip {
    position: absolute;
    left: 0;
    bottom: calc(100% + 4px);
    z-index: 15;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 100%;
    padding: 2px 6px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--bg);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
    font-size: 10.5px;
    line-height: 1.3;
    color: var(--fg);
    pointer-events: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .seismo-tip__dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    flex: none;
    background: var(--seismo-llm);
  }
  .seismo-tip__dot[data-kind="box"] { background: var(--seismo-box); }
  .seismo-tip__dot[data-kind="mac"] { background: var(--seismo-mac); }
  .seismo-tip__dot[data-kind="web"] { background: var(--seismo-web); }
  .seismo-tip__dot[data-kind="err"],
  .seismo-tip__dot[data-kind="wait"] { background: var(--seismo-alert, var(--bad)); }
  .seismo-tip__text {
    overflow: hidden;
    text-overflow: ellipsis;
    font-variant-numeric: tabular-nums;
  }
  .seismo {
    display: block;
    width: 100%;
    height: 12px;
    overflow: visible;
  }
  .seismo[data-size="medium"] {
    height: 16px;
  }
  .seismo[data-size="large"] {
    height: 36px;
  }
  .seismo__hit {
    fill: transparent;
  }
  .seismo__base {
    stroke: color-mix(in srgb, var(--line) 75%, transparent);
    stroke-width: 1;
  }
  .seismo__crack {
    stroke: var(--seismo-alert, var(--bad));
    stroke-width: 1.25;
    stroke-dasharray: 3 2.5;
    opacity: 0.85;
  }
  .seismo__bar {
    transition: height 180ms ease, y 180ms ease, opacity 120ms ease;
    opacity: 0.85;
  }
  .seismo--inspecting .seismo__bar {
    opacity: 0.32;
  }
  .seismo--inspecting .seismo__bar--active {
    opacity: 1;
  }
  .seismo__bar[data-kind="empty"] {
    fill: var(--seismo-empty);
    opacity: 0.7;
  }
  .seismo__bar[data-kind="llm"] {
    fill: var(--seismo-llm);
  }
  .seismo__bar[data-kind="box"] {
    fill: var(--seismo-box);
  }
  .seismo__bar[data-kind="mac"] {
    fill: var(--seismo-mac);
  }
  .seismo__bar[data-kind="web"] {
    fill: var(--seismo-web);
  }
  .seismo__bar[data-kind="err"],
  .seismo__bar[data-kind="wait"] {
    fill: var(--seismo-alert, var(--bad));
    opacity: 0.94;
  }
  .seismo--running .seismo__bar {
    opacity: 0.92;
  }
  .seismo__bar--live {
    animation: seismo-breathe 1.25s ease-in-out infinite alternate;
    transform-origin: center bottom;
  }
  @keyframes seismo-breathe {
    from { opacity: 0.55; }
    to { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .seismo__bar,
    .seismo__bar--live {
      transition: none;
      animation: none;
    }
  }
</style>
