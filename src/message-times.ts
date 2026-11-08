export type MessageTimeRow = { id: string; created_at: string | number };

export function messageTimeMs(raw: string | number): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : null;
  const text = raw.trim();
  if (/^\d+$/.test(text)) return messageTimeMs(Number(text));
  const ms = Date.parse(text.includes("T") ? text : text.replace(" ", "T") + "Z");
  return Number.isFinite(ms) ? ms : null;
}

export function collectMessageTimes(rows: Iterable<MessageTimeRow>): Record<string, number> {
  const times: Record<string, number> = {};
  for (const row of rows) {
    const ms = messageTimeMs(row.created_at);
    if (ms !== null) times[row.id] = ms;
  }
  return times;
}

export const MESSAGE_TIME_TABLES = ["cf_agents_session_messages", "assistant_messages"] as const;
