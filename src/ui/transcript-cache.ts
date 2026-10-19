export class TranscriptCache<T> {
  private readonly transcripts = new Map<string, readonly T[]>();

  constructor(private readonly capacity: number) {}

  read(sessionId: string): T[] | null {
    const cached = this.transcripts.get(sessionId);
    if (!cached?.length) return null;
    this.transcripts.delete(sessionId);
    this.transcripts.set(sessionId, cached);
    return [...cached];
  }

  write(sessionId: string, transcript: readonly T[]): void {
    this.transcripts.delete(sessionId);
    this.transcripts.set(sessionId, transcript);
    while (this.transcripts.size > this.capacity) {
      const oldest = this.transcripts.keys().next().value;
      if (oldest === undefined) break;
      this.transcripts.delete(oldest);
    }
  }
}
