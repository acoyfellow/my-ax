export type ForkEntry = {
  kind: string;
  model?: readonly unknown[];
  data?: unknown;
};

type SourceEntry = { id: number; kind: string; model?: readonly unknown[]; data?: unknown };

const COPIED_KINDS = new Set(["pi.user", "pi.assistant", "pi.tool-result"]);

export function parseForkPoint(messageId: string): number | null {
  const match = /^pi-(\d+)-\d+$/.exec(messageId);
  return match ? Number(match[1]) : null;
}

export function forkEntriesUpTo(entries: readonly SourceEntry[], entryId: number): ForkEntry[] {
  const ordered = [...entries].sort((a, b) => a.id - b.id);
  if (!ordered.some((entry) => entry.id === entryId)) throw new Error("Fork point was not found in this conversation.");
  return ordered
    .filter((entry) => entry.id <= entryId && COPIED_KINDS.has(entry.kind))
    .map((entry) => ({ kind: entry.kind, ...(entry.model ? { model: entry.model } : {}), ...(entry.data !== undefined ? { data: entry.data } : {}) }));
}
