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

  function barHeight(bar: SeismoBar | null): number {
    if (!bar) return 2;
    return Math.max(4, Math.round((bar.v / 100) * 28));
  }
</script>

<svg
  class="seismo"
  class:seismo--running={running}
  class:seismo--blocked={isBlocked}
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
    <rect
      class="seismo__bar"
      class:seismo__bar--live={running && i >= SLOTS - 3}
      data-kind={bar ? bar.k : "empty"}
      x={i * 10 + 1.5}
      y={31 - h}
      width="7"
      height={h}
      rx="1.5"
    />
  {/each}
</svg>

<style>
  .seismo {
    display: block;
    width: 100%;
    height: 12px;
    pointer-events: none;
    overflow: visible;
  }
  .seismo[data-size="medium"] {
    height: 16px;
  }
  .seismo[data-size="large"] {
    height: 44px;
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
    transition: height 180ms ease, y 180ms ease, opacity 180ms ease;
    opacity: 0.85;
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
