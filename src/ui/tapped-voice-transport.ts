import {
  WebSocketVoiceTransport,
  type VoiceAudioFormat,
  type VoiceTransport,
} from "@cloudflare/voice/client";
import { frameLevelEnvelope, type AudioLevelEnvelope } from "./voice-levels";

export interface TappedVoiceTransportOptions {
  agent: string;
  name?: string;
  host?: string;
  query?: Record<string, string | null | undefined>;
}

type MessageData = string | ArrayBuffer | Blob;
type ScheduledEnvelope = AudioLevelEnvelope & { startsAt: number; endsAt: number };

const MAX_PENDING_MEASUREMENTS = 32;
const MAX_OUTPUT_ENVELOPES = 2_048;
const MAX_MIRRORED_PLAYBACK_MS = 60_000;

export class TappedVoiceTransport implements VoiceTransport {
  #inner: VoiceTransport;
  #onMessage: ((data: MessageData) => void) | null = null;
  #format: VoiceAudioFormat | null = null;
  #sampleRate = 16_000;
  #inCall = false;
  #measurementGeneration = 0;
  #measurementQueue = Promise.resolve();
  #pendingMeasurements = 0;
  #outputEnvelopes: ScheduledEnvelope[] = [];
  #outputEnvelopeIndex = 0;
  #outputCursor = 0;

  constructor(options: TappedVoiceTransportOptions, inner?: VoiceTransport) {
    this.#inner = inner ?? new WebSocketVoiceTransport(options);
    this.#inner.onmessage = (data) => {
      this.#measure(data);
      this.#onMessage?.(data);
    };
  }

  get connected(): boolean {
    return this.#inner.connected;
  }

  sendJSON(data: Record<string, unknown>): void {
    if (data.type === "start_call") {
      this.#inCall = true;
      this.#resetOutputMeasurement();
    }
    if (data.type === "end_call") {
      this.#inCall = false;
      this.#resetOutputMeasurement();
    }
    if (data.type === "interrupt") this.#resetOutputMeasurement();
    this.#inner.sendJSON(data);
  }

  sendBinary(data: ArrayBuffer): void {
    this.#inner.sendBinary(data);
  }

  connect(): void {
    this.#inner.connect();
  }

  disconnect(): void {
    this.#inCall = false;
    this.#resetOutputMeasurement();
    this.#inner.disconnect();
  }

  get onopen(): (() => void) | null {
    return this.#inner.onopen;
  }

  set onopen(listener: (() => void) | null) {
    this.#inner.onopen = listener;
  }

  get onclose(): (() => void) | null {
    return this.#inner.onclose;
  }

  set onclose(listener: (() => void) | null) {
    this.#inner.onclose = listener;
  }

  get onerror(): ((error?: unknown) => void) | null {
    return this.#inner.onerror;
  }

  set onerror(listener: ((error?: unknown) => void) | null) {
    this.#inner.onerror = listener;
  }

  get onmessage(): ((data: MessageData) => void) | null {
    return this.#onMessage;
  }

  set onmessage(listener: ((data: MessageData) => void) | null) {
    this.#onMessage = listener;
  }

  getOutputLevel(): number {
    const now = performance.now();
    while (this.#outputEnvelopes[this.#outputEnvelopeIndex]?.endsAt <= now) {
      this.#outputEnvelopeIndex++;
    }
    if (
      this.#outputEnvelopeIndex > 32 &&
      this.#outputEnvelopeIndex * 2 >= this.#outputEnvelopes.length
    ) {
      this.#outputEnvelopes = this.#outputEnvelopes.slice(this.#outputEnvelopeIndex);
      this.#outputEnvelopeIndex = 0;
    }
    const envelope = this.#outputEnvelopes[this.#outputEnvelopeIndex];
    if (!envelope || now < envelope.startsAt) return 0;
    const index = Math.min(
      envelope.levels.length - 1,
      Math.floor((now - envelope.startsAt) / envelope.windowDurationMs),
    );
    return envelope.levels[index];
  }

  async waitForOutputMeasurements(): Promise<void> {
    await this.#measurementQueue;
  }

  #measure(data: MessageData): void {
    if (typeof data === "string") {
      this.#readAudioConfiguration(data);
      return;
    }
    if (!this.#inCall || this.#pendingMeasurements >= MAX_PENDING_MEASUREMENTS) return;
    this.#pendingMeasurements++;
    const generation = this.#measurementGeneration;
    const buffer = data instanceof ArrayBuffer ? Promise.resolve(data) : data.arrayBuffer();
    const format = this.#format;
    const sampleRate = this.#sampleRate;
    this.#measurementQueue = this.#measurementQueue
      .then(() => buffer)
      .then((frame) => frameLevelEnvelope(frame, format, sampleRate))
      .then((envelope) => {
        if (generation !== this.#measurementGeneration || envelope.levels.length === 0) return;
        const startsAt = Math.max(performance.now(), this.#outputCursor);
        const endsAt = startsAt + envelope.durationMs;
        if (
          this.#outputEnvelopes.length - this.#outputEnvelopeIndex >= MAX_OUTPUT_ENVELOPES ||
          endsAt - performance.now() > MAX_MIRRORED_PLAYBACK_MS
        ) {
          this.#outputCursor = endsAt;
          return;
        }
        this.#outputEnvelopes.push({ ...envelope, startsAt, endsAt });
        this.#outputCursor = endsAt;
      })
      .catch(() => {})
      .finally(() => {
        this.#pendingMeasurements--;
      });
  }

  #readAudioConfiguration(data: string): void {
    try {
      const message = JSON.parse(data) as { type?: string; format?: VoiceAudioFormat; sampleRate?: number };
      if (message.type !== "audio_config" || !message.format) return;
      this.#format = message.format;
      this.#sampleRate = typeof message.sampleRate === "number" && message.sampleRate > 0
        ? message.sampleRate
        : 16_000;
    } catch {}
  }

  #resetOutputMeasurement(): void {
    this.#measurementGeneration++;
    this.#measurementQueue = Promise.resolve();
    this.#outputEnvelopes = [];
    this.#outputEnvelopeIndex = 0;
    this.#outputCursor = 0;
  }
}
