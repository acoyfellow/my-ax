import type { ComposerTarget } from "./composer-route";

export { shouldSendToRoot } from "./composer-route";

export const composerRoute = $state<{ target: ComposerTarget; sendToRoot: ((text: string) => void) | null }>({ target: "page", sendToRoot: null });

export function routeComposerTo(target: ComposerTarget) {
  composerRoute.target = target;
}

export function registerRootSender(send: ((text: string) => void) | null) {
  composerRoute.sendToRoot = send;
}
