export type ComposerTarget = "page" | "root";

export function shouldSendToRoot(followsTab: boolean, route: { target: ComposerTarget; sendToRoot: unknown }): boolean {
  return followsTab && route.target === "root" && typeof route.sendToRoot === "function";
}
