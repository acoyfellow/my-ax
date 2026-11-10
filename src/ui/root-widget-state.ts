export type WidgetPlace = "inline" | "floating";

export type PipCapability = { available: true } | { available: false; reason: string };

export function pipCapability(win: { documentPictureInPicture?: unknown; isSecureContext?: boolean } | undefined): PipCapability {
  if (!win) return { available: false, reason: "Floating window needs a browser window." };
  if (win.isSecureContext === false) return { available: false, reason: "Floating window needs a secure page." };
  const api = win.documentPictureInPicture as { requestWindow?: unknown } | undefined;
  if (!api || typeof api.requestWindow !== "function") return { available: false, reason: "Floating window needs Chrome or Edge on desktop." };
  return { available: true };
}

export type DraftStore = { get(): string; set(value: string): void };

export function memoryDraftStore(initial = ""): DraftStore {
  let value = initial;
  return { get: () => value, set: (next) => { value = next; } };
}

export function storageDraftStore(storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined, key: string): DraftStore {
  const fallback = memoryDraftStore();
  if (!storage) return fallback;
  return {
    get: () => {
      try { return storage.getItem(key) ?? ""; } catch { return fallback.get(); }
    },
    set: (next) => {
      try {
        if (next) storage.setItem(key, next);
        else storage.removeItem(key);
      } catch {
        fallback.set(next);
      }
    },
  };
}

export function rootDraftKey(rootId: string): string {
  return `my-ax-root-draft:${rootId}`;
}

export type WidgetTurn = "working" | "idle" | "error" | "offline";

export function widgetTurn(input: { connected: boolean; busy: boolean; lastRole: string | null }): WidgetTurn {
  if (!input.connected) return "offline";
  if (input.busy) return "working";
  if (input.lastRole === "error") return "error";
  return "idle";
}

export function widgetTurnLabel(turn: WidgetTurn): string {
  if (turn === "working") return "Working";
  if (turn === "error") return "Last turn failed";
  if (turn === "offline") return "Reconnecting";
  return "Ready";
}
