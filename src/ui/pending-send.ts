export const PENDING_SEND_TIMEOUT_MS = 15_000;

export type PendingSendClock = {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
};

export type PendingSendQueue<T> = {
  enqueue(clientMsgId: string, payload: T, onTimeout: () => void): boolean;
  flush(deliver: (payload: T, clientMsgId: string) => void): void;
  clear(): void;
  size(): number;
};

type PendingEntry<T> = { payload: T; timer: unknown };

export function createPendingSendQueue<T>(
  clock: PendingSendClock,
  timeoutMs: number = PENDING_SEND_TIMEOUT_MS,
): PendingSendQueue<T> {
  const entries = new Map<string, PendingEntry<T>>();

  function enqueue(clientMsgId: string, payload: T, onTimeout: () => void): boolean {
    if (entries.has(clientMsgId)) return false;
    const timer = clock.schedule(() => {
      if (!entries.delete(clientMsgId)) return;
      onTimeout();
    }, timeoutMs);
    entries.set(clientMsgId, { payload, timer });
    return true;
  }

  function flush(deliver: (payload: T, clientMsgId: string) => void): void {
    const ready = [...entries];
    entries.clear();
    for (const [clientMsgId, entry] of ready) {
      clock.cancel(entry.timer);
      deliver(entry.payload, clientMsgId);
    }
  }

  function clear(): void {
    for (const entry of entries.values()) clock.cancel(entry.timer);
    entries.clear();
  }

  return { enqueue, flush, clear, size: () => entries.size };
}

export const RECONNECTING_SEND_ERROR =
  "Message not sent: reconnecting. Your draft is still in the composer — retry when the connection is live.";

