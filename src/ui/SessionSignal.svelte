<script lang="ts">
  import { sessionSignalLabel, type SessionSignal } from "./session-signal";

  const { signal }: { signal: SessionSignal } = $props();
</script>

<span class="session-row__signal" data-signal={signal} role="img" aria-label={sessionSignalLabel(signal)} title={sessionSignalLabel(signal)}></span>

<style>
  :global(.session-row__signal) { flex: none; width: 7px; height: 7px; border-radius: 999px; background: color-mix(in srgb, var(--fg-mut) 45%, transparent); }
  :global(.session-row__signal[data-signal="error"]) { background: var(--bad); }
  :global(.session-row__signal[data-signal="running"]) { width: 10px; height: 10px; background: transparent; box-sizing: border-box; border: 2px solid color-mix(in srgb, var(--good) 25%, transparent); border-top-color: var(--good); animation: session-signal-spin 700ms linear infinite; }
  @keyframes -global-session-signal-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { :global(.session-row__signal[data-signal="running"]) { animation-duration: 1.8s; } }
</style>
