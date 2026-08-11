const COMPACTION_SUMMARY_ID_PREFIX = "compaction_";

export function isCompactionSummaryId(id: unknown): boolean {
  return typeof id === "string" && id.startsWith(COMPACTION_SUMMARY_ID_PREFIX);
}

export function ownerVisibleTranscript<T extends { id: unknown }>(messages: readonly T[]): T[] {
  return messages.filter((message) => !isCompactionSummaryId(message.id));
}
