import type { PiSnapshot } from "./pi-transcript";

const KEY_PREFIX = "my-ax-pi-snapshot:";
const INDEX_KEY = "my-ax-pi-snapshot-index";

type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export class PiSnapshotStore {
  constructor(private readonly storage: KeyValueStore | null, private readonly capacity = 24) {}

  read(sessionId: string): PiSnapshot | null {
    try {
      const raw = this.storage?.getItem(KEY_PREFIX + sessionId);
      if (!raw) return null;
      const snapshot = JSON.parse(raw) as PiSnapshot;
      return Array.isArray(snapshot.entries) && snapshot.entries.length ? snapshot : null;
    } catch {
      return null;
    }
  }

  write(sessionId: string, snapshot: PiSnapshot): void {
    if (!this.storage || !snapshot.entries.length) return;
    const index = this.index().filter((id) => id !== sessionId);
    index.push(sessionId);
    while (index.length > this.capacity) this.remove(index.shift()!);
    try {
      this.storage.setItem(KEY_PREFIX + sessionId, JSON.stringify(snapshot));
    } catch {
      for (const id of index.splice(0, Math.max(1, index.length - 2))) if (id !== sessionId) this.remove(id);
      try { this.storage.setItem(KEY_PREFIX + sessionId, JSON.stringify(snapshot)); } catch { return; }
    }
    try { this.storage.setItem(INDEX_KEY, JSON.stringify(index)); } catch {}
  }

  private remove(sessionId: string): void {
    try { this.storage?.removeItem(KEY_PREFIX + sessionId); } catch {}
  }

  private index(): string[] {
    try {
      const parsed = JSON.parse(this.storage?.getItem(INDEX_KEY) ?? "[]");
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
    } catch {
      return [];
    }
  }
}
