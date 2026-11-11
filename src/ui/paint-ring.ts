import { recordWebReceipt, webFeatures } from "./web-platform.svelte";

let registered = false;

export function registerStatusRing() {
  if (registered || typeof CSS === "undefined" || !("paintWorklet" in CSS) || !webFeatures.paintRing) return;
  registered = true;
  const worklet = (CSS as unknown as { paintWorklet?: { addModule(url: string): Promise<void> } }).paintWorklet;
  if (!worklet) return;
  worklet.addModule("/static/worklets/status-ring.js").then(
    () => recordWebReceipt("paintRing", "Registered status ring paint worklet"),
    () => { registered = false; },
  );
}
