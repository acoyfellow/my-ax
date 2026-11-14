export const WEB_FEATURES = {
  wakeLock: { label: "Keep screen on", hint: "While the agent works.", defaultOn: true },
  voice: { label: "AX voice commands", hint: "Say “AX …”. Chrome may use its speech service.", defaultOn: false },
  storagePersist: { label: "Keep my data", hint: "Ask the browser not to clear it.", defaultOn: true },
  tabLeader: { label: "One live tab", hint: "Other tabs mirror it.", defaultOn: true },
  virtualKeyboard: { label: "Lift input bar", hint: "Above the phone keyboard.", defaultOn: true },
  scrollProgress: { label: "Scroll progress bar", hint: "Thin bar at the top.", defaultOn: true },
  location: { label: "Share location", hint: "About 1 km. The browser asks first.", defaultOn: false },
  paintRing: { label: "Desk status rings", hint: "Rings on Desk cards.", defaultOn: true },
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
