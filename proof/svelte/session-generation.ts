export type SessionGeneration = Readonly<{
  sessionId: string;
  generation: number;
}>;

/** Invalidates asynchronous session work whenever the active conversation changes. */
export class SessionGenerationGuard {
  #sessionId: string | null = null;
  #generation = 0;

  activate(sessionId: string | null): void {
    this.#sessionId = sessionId;
    this.#generation += 1;
  }

  capture(): SessionGeneration | null {
    return this.#sessionId
      ? { sessionId: this.#sessionId, generation: this.#generation }
      : null;
  }

  isCurrent(expected: SessionGeneration, currentSessionId: string | null): boolean {
    return expected.sessionId === this.#sessionId
      && expected.sessionId === currentSessionId
      && expected.generation === this.#generation;
  }
}
