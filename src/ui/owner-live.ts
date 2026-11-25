import { createReconnectingSocket, type ReconnectingSocket } from "./reconnecting-socket";

export const MACHINES_CHANGED = "machines.changed";
export const SESSION_TILE_CHANGED = "session.tile";

type Listener = (payload?: Record<string, unknown>) => void;

const listeners = new Map<string, Set<Listener>>();
let socket: ReconnectingSocket | null = null;

export function ownerLiveUrl(location: Pick<Location, "protocol" | "host">): string {
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/agents/live`;
}

export function frameType(data: string): string | null {
  try {
    const frame = JSON.parse(data) as { type?: unknown };
    return typeof frame?.type === "string" ? frame.type : null;
  } catch {
    return null;
  }
}

function notify(type: string, payload?: Record<string, unknown>) {
  for (const listener of listeners.get(type) ?? []) listener(payload);
}

function ensureSocket() {
  if (socket || typeof window === "undefined") return;
  socket = createReconnectingSocket(ownerLiveUrl(window.location), {
    onOpen: () => notify(MACHINES_CHANGED),
    onClose: () => {},
    onError: () => {},
    onMessage: (data) => {
      try {
        const parsed = JSON.parse(data) as Record<string, unknown>;
        if (typeof parsed?.type === "string") notify(parsed.type, parsed);
      } catch {}
    },
  });
}

export function onOwnerEvent(type: string, listener: Listener): () => void {
  const set = listeners.get(type) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(type, set);
  ensureSocket();
  return () => {
    set.delete(listener);
    if ([...listeners.values()].every((entries) => entries.size === 0)) {
      socket?.close();
      socket = null;
    }
  };
}
