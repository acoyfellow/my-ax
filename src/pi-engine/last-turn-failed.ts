export function lastTurnFailed(entries: readonly unknown[]): boolean {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index] as { kind?: string; model?: readonly { role?: string; stopReason?: string }[] };
    if (entry.kind === "pi.user") return false;
    if (entry.kind === "pi.assistant") return entry.model?.some((message) => message.role === "assistant" && message.stopReason === "error") ?? false;
  }
  return false;
}
