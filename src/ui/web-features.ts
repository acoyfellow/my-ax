export const WEB_FEATURES = {
  wakeLock: { label: "Keep screen on", hint: "While a turn runs, or when you turn it on from the top bar.", defaultOn: true },
  voice: { label: "AX voice commands", hint: "Shows a mic button in the top bar. Only phrases that start with AX do anything; changes need a spoken confirm. Chrome may send the audio to its speech service.", defaultOn: false },
  paintRing: { label: "Status rings on Desk cards", hint: "Draws a ring on each Desk card status pill with a CSS paint worklet.", defaultOn: true },
} as const;

export type WebFeature = keyof typeof WEB_FEATURES;

export type WebFeatureSwitches = Record<WebFeature, boolean>;

export const WEB_FEATURE_STORAGE_PREFIX = "my-ax-web-feature:";

type StorageLike = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export function readWebFeatures(storage: Pick<StorageLike, "getItem"> | null): WebFeatureSwitches {
  const switches = {} as WebFeatureSwitches;
  for (const feature of Object.keys(WEB_FEATURES) as WebFeature[]) {
    const stored = storage?.getItem(WEB_FEATURE_STORAGE_PREFIX + feature) ?? null;
    switches[feature] = stored === null ? WEB_FEATURES[feature].defaultOn : stored === "on";
  }
  return switches;
}

export function writeWebFeature(storage: Pick<StorageLike, "setItem">, feature: WebFeature, on: boolean) {
  storage.setItem(WEB_FEATURE_STORAGE_PREFIX + feature, on ? "on" : "off");
}
