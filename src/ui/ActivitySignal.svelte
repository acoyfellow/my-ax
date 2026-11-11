<script lang="ts">
  import { wsState } from "@my-ax/store";
  import { activitySignalLabel, activitySignalOf } from "./activity-signal";

  const signal = $derived(activitySignalOf(wsState.conn, wsState.status));
  const label = $derived(activitySignalLabel(signal));
</script>

<span class="activity-signal" data-activity-signal={signal} role="status" aria-label={label} title={label}>
  <span class="activity-signal__mark" aria-hidden="true"></span>
</span>

<style>
  .activity-signal { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; }
  .activity-signal__mark { display: block; box-sizing: border-box; width: 10px; height: 10px; border-radius: 999px; background: var(--good); }
  [data-activity-signal="running"] .activity-signal__mark { width: 14px; height: 14px; background: transparent; border: 2px solid color-mix(in srgb, var(--good) 25%, transparent); border-top-color: var(--good); animation: activity-spin 700ms linear infinite; }
  [data-activity-signal="connecting"] .activity-signal__mark { width: 12px; height: 12px; background: transparent; border: 2px solid var(--warn); animation: activity-pulse 1.2s ease-in-out infinite; }
  [data-activity-signal="offline"] .activity-signal__mark { width: 10px; height: 10px; border-radius: 2px; background: var(--bad); transform: rotate(45deg); }
  @keyframes activity-spin { to { transform: rotate(360deg); } }
  @keyframes activity-pulse { 50% { transform: scale(0.6); opacity: 0.45; } }
  @media (prefers-reduced-motion: reduce) {
    [data-activity-signal="running"] .activity-signal__mark { animation: none; border-color: var(--good); border-top-color: transparent; }
    [data-activity-signal="connecting"] .activity-signal__mark { animation: none; }
  }
</style>
