export type VoiceTurnChatCallbacks = {
  onStart: () => Promise<void>;
  onEvent: (json: string) => Promise<void>;
  onDone: () => Promise<void>;
  onError: (error: string) => Promise<void>;
};

export type VoiceTurnChatRunner = (transcript: string, callbacks: VoiceTurnChatCallbacks) => Promise<void>;

export const MAX_VOICE_TURN_BUFFER_CHARS = 16_384;
const VOICE_TURN_OVERFLOW_NOTICE = "I have kept the full response in the chat. ";
const MAX_QUEUED_VOICE_TURN_CHARS = Math.floor(MAX_VOICE_TURN_BUFFER_CHARS / 2);

class BoundedVoiceTextBuffer {
  #text = "";

  get hasText(): boolean {
    return this.#text.length > 0;
  }

  push(chunk: string, maxLength = MAX_VOICE_TURN_BUFFER_CHARS): void {
    const capacity = Math.max(0, maxLength);
    if (!chunk || capacity === 0) return;
    if (chunk.length >= capacity) {
      this.#text = this.#withOverflowNotice(chunk.slice(-(capacity - VOICE_TURN_OVERFLOW_NOTICE.length)), capacity);
      return;
    }
    if (this.#text.length + chunk.length <= capacity) {
      this.#text += chunk;
      return;
    }
    const suffixLength = capacity - VOICE_TURN_OVERFLOW_NOTICE.length;
    this.#text = this.#withOverflowNotice((this.#text + chunk).slice(-suffixLength), capacity);
  }

  take(maxLength = this.#text.length): string {
    const length = Math.max(0, Math.min(maxLength, this.#text.length));
    const text = this.#text.slice(0, length);
    this.#text = this.#text.slice(length);
    return text;
  }

  clear(): void {
    this.#text = "";
  }

  #withOverflowNotice(suffix: string, maxLength: number): string {
    const firstSpace = suffix.search(/\s/);
    const completeSuffix = firstSpace >= 0 ? suffix.slice(firstSpace).trimStart() : suffix;
    return (VOICE_TURN_OVERFLOW_NOTICE + completeSuffix).slice(0, maxLength);
  }
}

export function createVoiceTurnStream(transcript: string, runChat: VoiceTurnChatRunner): ReadableStream<string> {
  const pending = new BoundedVoiceTextBuffer();
  let controller: ReadableStreamDefaultController<string> | null = null;
  let settled = false;
  let complete = false;
  let emittedText = false;
  let queuedTextLength = 0;

  const flush = (requested = false) => {
    if (!controller || settled || !pending.hasText) {
      if (controller && complete && !settled && !pending.hasText) {
        settled = true;
        controller.close();
      }
      return;
    }
    if (!requested && (controller.desiredSize ?? 0) <= 0) return;
    const availableLength = MAX_VOICE_TURN_BUFFER_CHARS - queuedTextLength;
    if (availableLength <= 0) return;
    const text = pending.take(Math.min(availableLength, MAX_QUEUED_VOICE_TURN_CHARS));
    controller.enqueue(text);
    queuedTextLength = (controller.desiredSize ?? 0) > 0 ? 0 : text.length;
    if (complete && !pending.hasText) {
      settled = true;
      controller.close();
    }
  };
  const close = () => {
    if (settled) return;
    complete = true;
    flush();
  };
  const fail = (error: unknown) => {
    if (settled) return;
    if (emittedText) {
      close();
      return;
    }
    settled = true;
    controller?.error(error instanceof Error ? error : new Error(String(error)));
  };

  return new ReadableStream<string>({
    start(value) {
      controller = value;
      const callbacks: VoiceTurnChatCallbacks = {
        onStart: async () => {},
        onEvent: async (json) => {
          try {
            const chunk = JSON.parse(json) as { type?: string; delta?: string };
            if (!settled && chunk.type === "text-delta" && chunk.delta) {
              emittedText = true;
              pending.push(chunk.delta, MAX_VOICE_TURN_BUFFER_CHARS - queuedTextLength);
              flush();
            }
          } catch {}
        },
        onDone: async () => { close(); },
        onError: async (error) => { fail(new Error(error)); },
      };
      void runChat(transcript, callbacks).catch(fail);
    },
    pull() {
      queuedTextLength = 0;
      flush(true);
    },
    cancel() {
      settled = true;
      queuedTextLength = 0;
      pending.clear();
    },
  }, { highWaterMark: 1 });
}

export class VoiceTurnReplyBuffer {
  #pending = new BoundedVoiceTextBuffer();
  #emittedReply = false;
  #interrupted = false;
  #complete = false;
  #waiters = new Set<(ready: boolean) => void>();

  push(chunk: string): void {
    if (this.#interrupted || this.#complete || !chunk) return;
    this.#pending.push(chunk);
    this.#resolveWaiters(true);
  }

  drain(): string[] {
    if (this.#interrupted || !this.#pending.hasText) return [];
    this.#emittedReply = true;
    return [this.#pending.take()];
  }

  finish(receivedText: boolean): string[] {
    const chunks = this.drain();
    if (!this.#interrupted && !this.#emittedReply && !receivedText) chunks.push("Sorry, I didn't catch a response.");
    return chunks;
  }

  waitForChunk(timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
    if (this.#pending.hasText) return Promise.resolve(true);
    if (this.#interrupted || this.#complete || signal?.aborted) return Promise.resolve(false);
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const abort = () => waiter(false);
      const waiter = (ready: boolean) => {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        this.#waiters.delete(waiter);
        resolve(ready);
      };
      this.#waiters.add(waiter);
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => waiter(false), Math.max(0, timeoutMs));
    });
  }

  complete(): void {
    this.#complete = true;
    this.#resolveWaiters(this.#pending.hasText);
  }

  interrupt(): void {
    this.#interrupted = true;
    this.#pending.clear();
    this.#resolveWaiters(false);
  }

  #resolveWaiters(ready: boolean): void {
    for (const resolve of [...this.#waiters]) resolve(ready);
  }
}

export type VoiceTurnStreamResult = { receivedText: boolean } | null;

export async function consumeVoiceTurnStream(
  response: ReadableStream<string>,
  signal: AbortSignal,
  onDelta: (delta: string) => void,
): Promise<VoiceTurnStreamResult> {
  const reader = response.getReader();
  let cancelIssued = false;
  const cancel = () => {
    if (cancelIssued) return;
    cancelIssued = true;
    void reader.cancel("voice turn interrupted").catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    let receivedText = false;
    while (!signal.aborted) {
      const next = await reader.read();
      if (next.done || signal.aborted) break;
      if (!next.value) continue;
      receivedText = true;
      onDelta(next.value);
    }
    if (signal.aborted) {
      cancel();
      return null;
    }
    return { receivedText };
  } finally {
    signal.removeEventListener("abort", cancel);
    if (signal.aborted) cancel();
  }
}
