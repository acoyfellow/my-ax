<script lang="ts">
  import { onMount } from "svelte";
  import { WEB_FEATURES, type WebFeature } from "./web-features";
  import { tabLeader } from "./tab-leader.svelte";
  import { setWebFeature, recordWebReceipt, wakeLockState, webFeatures, webReceipts } from "./web-platform.svelte";

  const supportChecks: Record<WebFeature, () => boolean> = {
    wakeLock: () => "wakeLock" in navigator,
    paintRing: () => "CSS" in window && "paintWorklet" in CSS,
    voice: () => "SpeechRecognition" in window || "webkitSpeechRecognition" in window,
    storagePersist: () => "storage" in navigator && typeof navigator.storage.persist === "function",
    tabLeader: () => "locks" in navigator && "BroadcastChannel" in window,
    virtualKeyboard: () => "virtualKeyboard" in navigator || "visualViewport" in window,
    scrollProgress: () => typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("animation-timeline: scroll()"),
    location: () => "geolocation" in navigator,
    gzipExport: () => typeof CompressionStream !== "undefined",
  };

  let supported = $state<Partial<Record<WebFeature, boolean>>>({});
  const features = Object.keys(WEB_FEATURES) as WebFeature[];

  function receiptText(feature: WebFeature): string {
    const receipt = webReceipts[feature];
    if (!receipt) return "Not used yet in this tab";
    return `${receipt.text} · ${new Date(receipt.at).toLocaleTimeString()}`;
  }

  let persisted = $state<boolean | null>(null);
  let usage = $state("");

  const roleText = { unknown: "Checking…", leader: "This tab leads", mirror: "Another tab leads; this one mirrors", solo: "Only tab (no Web Locks)" } as const;

  async function refreshEstimate() {
    if (typeof navigator.storage?.estimate !== "function") return;
    const e = await navigator.storage.estimate();
    const mb = (n: number | undefined) => (Math.round(((n ?? 0) / 1048576) * 10) / 10).toFixed(1);
    usage = `Using ${mb(e.usage)} MB of ${mb(e.quota)} MB`;
  }

  async function keepData() {
    if (typeof navigator.storage?.persist !== "function") return;
    persisted = await navigator.storage.persist();
    recordWebReceipt("storagePersist", persisted ? "Kept" : "Not kept");
    await refreshEstimate().catch(() => {});
  }

  onMount(() => {
    if (typeof navigator.storage?.persisted === "function") navigator.storage.persisted().then((v) => (persisted = v)).catch(() => {});
    refreshEstimate().catch(() => {});
    supported = Object.fromEntries(features.map((feature) => [feature, supportChecks[feature]()]));
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
        {#if feature === "storagePersist" && supported[feature]}
          <div class="text-xs text-fg-mut mt-1">
            <button type="button" class="underline" disabled={!webFeatures.storagePersist} onclick={keepData}>Keep my data</button>
            {#if persisted !== null}<span class="block">{persisted ? "Kept: the browser will not clear my ax data" : "Not kept: the browser may clear it under disk pressure"}</span>{/if}
            {#if usage}<span class="block">{usage}</span>{/if}
          </div>
        {/if}
        {#if feature === "tabLeader" && supported[feature] && webFeatures.tabLeader}
          <div class="text-xs text-fg-mut mt-1" data-tab-role={tabLeader.role}>{roleText[tabLeader.role]}</div>
        {/if}
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
