export type SaveBoundary = "pause" | "compaction" | "fork" | "recycle" | "restore" | "seed";

export const SAVE_BOUNDARIES: readonly SaveBoundary[] = ["pause", "compaction", "fork", "recycle", "restore", "seed"];

export function isSaveBoundary(value: string): value is SaveBoundary {
  return (SAVE_BOUNDARIES as readonly string[]).includes(value);
}

export type SaveQueue = { save: <T>(boundary: SaveBoundary, work: () => Promise<T>) => Promise<T> };

export function createSaveQueue(): SaveQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    save: <T>(_boundary: SaveBoundary, work: () => Promise<T>): Promise<T> => {
      const run = tail.then(work, work);
      tail = run.catch(() => undefined);
      return run;
    },
  };
}

export function compactionFinished(events: readonly { type: string; error?: string }[]): boolean {
  return events.some((event) => event.type === "compaction_end" && !event.error);
}
