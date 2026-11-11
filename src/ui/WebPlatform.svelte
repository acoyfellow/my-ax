<script lang="ts">
  import { onMount } from "svelte";
  import { WEB_FEATURES, type WebFeature } from "./web-features";
  import { setWebFeature, recordWebReceipt, wakeLockState, webFeatures, webReceipts } from "./web-platform.svelte";

  const supportChecks: Record<WebFeature, () => boolean> = {
    wakeLock: () => "wakeLock" in navigator,
    voice: () => "SpeechRecognition" in window || "webkitSpeechRecognition" in window,
    virtualKeyboard: () => "virtualKeyboard" in navigator || "visualViewport" in window,
    scrollProgress: () => typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("animation-timeline: scroll()"),
  };

  let supported = $state<Partial<Record<WebFeature, boolean>>>({});
  const features = Object.keys(WEB_FEATURES) as WebFeature[];

  function receiptText(feature: WebFeature): string {
    const receipt = webReceipts[feature];
    if (!receipt) return "Not used yet in this tab";
    return `${receipt.text} · ${new Date(receipt.at).toLocaleTimeString()}`;
  }

  onMount(() => {
    const next: Partial<Record<WebFeature, boolean>> = {};
    for (const feature of features) {
      try { next[feature] = supportChecks[feature](); } catch { next[feature] = false; }
    }
    supported = next;
  });
</script>

<section class="web-platform" data-web-platform>
  <h3 class="text-xs font-medium text-fg-mut mb-1.5">Web platform</h3>
  <ul class="web-platform__list">
    {#each features as feature (feature)}
      <li class="web-platform__row" data-web-feature={feature} data-supported={supported[feature] ? "true" : "false"}>
        <label class="web-platform__label">
          <input type="checkbox" role="switch" checked={webFeatures[feature]} disabled={!supported[feature]} onchange={(event) => setWebFeature(feature, (event.currentTarget as HTMLInputElement).checked)} />
          <span>
            <span class="block text-sm text-fg">{WEB_FEATURES[feature].label}</span>
            <span class="block text-xs text-fg-mut">{supported[feature] ? WEB_FEATURES[feature].hint : "This browser does not support it"}</span>
            <span class="block text-xs text-fg-mut/80" data-web-receipt={feature}>{receiptText(feature)}{feature === "wakeLock" && wakeLockState.held ? " · on now" : ""}</span>
          </span>
        </label>
      </li>
    {/each}
  </ul>
</section>

<style>
  .web-platform__list { display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--line); border-radius: 8px; padding: 8px; background: var(--bg); }
  .web-platform__label { display: flex; gap: 10px; align-items: flex-start; min-height: 44px; cursor: pointer; }
  .web-platform__label input { margin-top: 4px; width: 16px; height: 16px; accent-color: var(--brand); }
  .web-platform__row[data-supported="false"] { opacity: 0.6; }
</style>
