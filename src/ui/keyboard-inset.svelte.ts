import { keyboardInset } from "./web/keyboard-inset";
import { recordWebReceipt, webFeatures } from "./web-platform.svelte";

type VirtualKeyboardLike = EventTarget & { overlaysContent: boolean; boundingRect?: { height: number } };

export function startKeyboardInset(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};
  let reported = false;
  const root = document.documentElement;

  const apply = (virtualKeyboard: VirtualKeyboardLike | null) => {
    const viewport = window.visualViewport;
    const inset = keyboardInset({
      virtualKeyboardHeight: virtualKeyboard?.boundingRect?.height ?? null,
      layoutViewportHeight: window.innerHeight,
      visualViewportHeight: viewport ? viewport.height : null,
      visualViewportOffsetTop: viewport ? viewport.offsetTop : null,
    });
    root.style.setProperty("--keyboard-inset", `${inset}px`);
    if (inset > 0 && !reported) {
      reported = true;
      recordWebReceipt("virtualKeyboard", `Moved the input bar above the keyboard (${inset} px)`);
    }
  };

  const stop = $effect.root(() => {
    $effect(() => {
      if (!webFeatures.virtualKeyboard) {
        const vk = "virtualKeyboard" in navigator ? (navigator as unknown as { virtualKeyboard: VirtualKeyboardLike }).virtualKeyboard : null;
        if (vk) vk.overlaysContent = false;
        root.style.setProperty("--keyboard-inset", "0px");
        return;
      }
      if ("virtualKeyboard" in navigator) {
        const vk = (navigator as unknown as { virtualKeyboard: VirtualKeyboardLike }).virtualKeyboard;
        vk.overlaysContent = true;
        const handler = () => apply(vk);
        vk.addEventListener("geometrychange", handler);
        return () => vk.removeEventListener("geometrychange", handler);
      }
      const viewport = window.visualViewport;
      if (!viewport) return;
      const handler = () => apply(null);
      viewport.addEventListener("resize", handler);
      viewport.addEventListener("scroll", handler);
      return () => {
        viewport.removeEventListener("resize", handler);
        viewport.removeEventListener("scroll", handler);
      };
    });
  });
  return stop;
}
