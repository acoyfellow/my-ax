import { readWebFeatures, writeWebFeature, type WebFeature, type WebFeatureSwitches } from "./web-features";

export const webFeatures = $state<WebFeatureSwitches>(readWebFeatures(typeof localStorage === "undefined" ? null : localStorage));

export const webReceipts = $state<Record<string, { at: number; text: string }>>({});

export function setWebFeature(feature: WebFeature, on: boolean) {
  webFeatures[feature] = on;
  if (typeof localStorage !== "undefined") writeWebFeature(localStorage, feature, on);
}

export function recordWebReceipt(feature: WebFeature, text: string) {
  webReceipts[feature] = { at: Date.now(), text };
}

export const wakeLockState = $state<{ held: boolean; manual: boolean }>({ held: false, manual: false });
