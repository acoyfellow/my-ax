export type QueuedMessage = { id: string; text: string };

export class LocalMessageQueue {
  private items: QueuedMessage[] = [];

  constructor(private readonly makeId: () => string) {}

  get messages(): readonly QueuedMessage[] {
    return this.items;
  }

  get size(): number {
    return this.items.length;
  }

  add(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.items = [...this.items, { id: this.makeId(), text: trimmed }];
  }

  remove(id: string): void {
    this.items = this.items.filter((item) => item.id !== id);
  }

  takeForEditing(): string {
    const combined = this.combined();
    this.items = [];
    return combined;
  }

  takeForSending(): string | null {
    if (this.items.length === 0) return null;
    const combined = this.combined();
    this.items = [];
    return combined;
  }

  private combined(): string {
    return this.items.map((item) => item.text).join("\n\n");
  }
}

export function shouldRecallQueue(input: { key: string; composerText: string; queued: number; modifier: boolean }): boolean {
  return input.key === "ArrowUp" && !input.modifier && input.queued > 0 && input.composerText.trim() === "";
}
