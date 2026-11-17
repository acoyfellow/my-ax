export type TransferEntry = { kind: string; model?: readonly unknown[]; data?: unknown; at?: number };

export type ChatTransfer = {
  version: 1;
  id: string;
  name: string;
  createdAt: string | null;
  updatedAt: string | null;
  pinned: boolean;
  entries: TransferEntry[];
};

type SourceEntry = { id: number; kind: string; model?: readonly unknown[]; data?: unknown };

const TRANSFERRED_KINDS = new Set(["pi.user", "pi.assistant", "pi.tool-result"]);
export const TRANSFER_MAX_BYTES = 50 * 1024 * 1024;

export function transferEntries(entries: readonly SourceEntry[], times: Record<number, number>): TransferEntry[] {
  return [...entries]
    .sort((a, b) => a.id - b.id)
    .filter((entry) => TRANSFERRED_KINDS.has(entry.kind))
    .map((entry) => ({
      kind: entry.kind,
      ...(entry.model ? { model: entry.model } : {}),
      ...(entry.data !== undefined ? { data: entry.data } : {}),
      ...(typeof times[entry.id] === "number" ? { at: times[entry.id] } : {}),
    }));
}

export function readTransfer(value: unknown): ChatTransfer | null {
  if (!value || typeof value !== "object") return null;
  const transfer = value as Partial<ChatTransfer>;
  if (transfer.version !== 1 || typeof transfer.id !== "string" || !Array.isArray(transfer.entries)) return null;
  if (!transfer.entries.every((entry) => entry && typeof entry === "object" && TRANSFERRED_KINDS.has((entry as TransferEntry).kind))) return null;
  return {
    version: 1,
    id: transfer.id,
    name: typeof transfer.name === "string" && transfer.name.trim() ? transfer.name.trim().slice(0, 200) : "Imported chat",
    createdAt: typeof transfer.createdAt === "string" ? transfer.createdAt : null,
    updatedAt: typeof transfer.updatedAt === "string" ? transfer.updatedAt : null,
    pinned: transfer.pinned === true,
    entries: transfer.entries as TransferEntry[],
  };
}
