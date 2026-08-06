export interface VoiceActivationClient {
  readonly connected: boolean;
  connect(): void;
  prepareAudio?(): void;
  startCall(): Promise<void>;
  disconnect(): void;
}

export type StoppableVoiceTrack = { stop(): void };

export type StoppableVoiceStream = {
  getTracks(): StoppableVoiceTrack[];
};

export class RetirableVoiceStream {
  #generation = 0;
  #stream: StoppableVoiceStream | null = null;
  #pending: Promise<StoppableVoiceStream | null> | null = null;

  constructor(private readonly acquire: () => Promise<StoppableVoiceStream>) {}

  prepare(): Promise<StoppableVoiceStream | null> {
    if (this.#stream) return Promise.resolve(this.#stream);
    if (this.#pending) return this.#pending;
    const generation = this.#generation;
    let acquisition: Promise<StoppableVoiceStream | null>;
    try {
      acquisition = this.acquire().then(
        (stream) => {
          if (generation !== this.#generation) {
            stopVoiceStream(stream);
            return null;
          }
          this.#stream = stream;
          return stream;
        },
        (error) => {
          if (generation !== this.#generation) return null;
          throw error;
        },
      );
    } catch (error) {
      acquisition = Promise.reject(error);
    }
    this.#pending = acquisition;
    void acquisition.then(
      () => { if (this.#pending === acquisition) this.#pending = null; },
      () => { if (this.#pending === acquisition) this.#pending = null; },
    );
    return acquisition;
  }

  retire(): void {
    this.#generation += 1;
    const stream = this.#stream;
    this.#stream = null;
    this.#pending = null;
    if (stream) stopVoiceStream(stream);
  }
}

function stopVoiceStream(stream: StoppableVoiceStream): void {
  for (const track of stream.getTracks()) track.stop();
}

function encodeVoicePcm(samples: Float32Array, sourceRate: number): ArrayBuffer {
  const sampleCount = Math.max(1, Math.round(samples.length * 16_000 / sourceRate));
  const pcm = new Int16Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    const position = index * sourceRate / 16_000;
    const lower = Math.min(samples.length - 1, Math.floor(position));
    const upper = Math.min(samples.length - 1, lower + 1);
    const fraction = position - lower;
    const sample = samples[lower] * (1 - fraction) + samples[upper] * fraction;
    pcm[index] = Math.round(Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32_768 : 32_767));
  }
  return pcm.buffer;
}

function voiceRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

export class BrowserVoiceAudioInput {
  onAudioLevel: ((rms: number) => void) | null = null;
  onAudioData: ((pcm: ArrayBuffer) => void) | null = null;
  #stream = new RetirableVoiceStream(() => navigator.mediaDevices.getUserMedia({
    audio: {
      sampleRate: { ideal: 48_000 },
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  }));
  #context: AudioContext | null = null;
  #source: MediaStreamAudioSourceNode | null = null;
  #processor: ScriptProcessorNode | null = null;
  #activeGeneration: number | null = null;
  #generation = 0;

  prepare(): void {
    const generation = ++this.#generation;
    this.#activeGeneration = generation;
    if (!this.#context) this.#context = new AudioContext({ sampleRate: 48_000 });
    void this.#context.resume().catch(() => {});
    void this.#stream.prepare().catch(() => {});
  }

  async start(): Promise<void> {
    const generation = this.#activeGeneration;
    if (generation === null) return;
    const stream = await this.#stream.prepare();
    if (!stream || generation !== this.#activeGeneration || this.#context === null) return;
    this.#source?.disconnect();
    this.#processor?.disconnect();
    const context = this.#context;
    const source = context.createMediaStreamSource(stream as MediaStream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (event) => {
      if (generation !== this.#activeGeneration) return;
      const samples = event.inputBuffer.getChannelData(0);
      this.onAudioLevel?.(voiceRms(samples));
      this.onAudioData?.(encodeVoicePcm(samples, context.sampleRate));
    };
    source.connect(processor);
    processor.connect(context.destination);
    this.#source = source;
    this.#processor = processor;
  }

  stop(): void {
    this.#generation += 1;
    this.#activeGeneration = null;
    this.#source?.disconnect();
    this.#source = null;
    this.#processor?.disconnect();
    this.#processor = null;
    const context = this.#context;
    this.#context = null;
    this.#stream.retire();
    if (context) void context.close().catch(() => {});
  }
}

export type VoicePreparationReason = "missing-client" | "wrong-session" | "disconnected-client";

export type VoiceActivationAttempt<Client extends VoiceActivationClient> =
  | { kind: "needs-session" }
  | { kind: "preparing"; reason: VoicePreparationReason; client: Client }
  | { kind: "started"; client: Client; completion: Promise<void> };

type PreparedVoiceClient<Client extends VoiceActivationClient> = {
  sessionId: string;
  client: Client;
  generation: number;
};

export async function createAndPrepareVoiceSession(
  createSession: () => Promise<string>,
  sessionIsCurrent: (sessionId: string) => boolean,
  connectChat: (sessionId: string) => void,
  prepareVoice: (sessionId: string) => void,
): Promise<string | null> {
  const sessionId = await createSession();
  if (!sessionIsCurrent(sessionId)) return null;
  connectChat(sessionId);
  prepareVoice(sessionId);
  return sessionId;
}

export class VoiceActivationLifecycle<Client extends VoiceActivationClient> {
  private prepared: PreparedVoiceClient<Client> | null = null;
  private generation = 0;

  prepare(sessionId: string, createClient: (sessionId: string) => Client): Client {
    if (this.prepared?.sessionId === sessionId) return this.prepared.client;
    this.clear();
    const client = createClient(sessionId);
    this.prepared = { sessionId, client, generation: this.generation };
    client.connect();
    return client;
  }

  activate(sessionId: string | null, createClient: (sessionId: string) => Client): VoiceActivationAttempt<Client> {
    if (!sessionId) {
      this.clear();
      return { kind: "needs-session" };
    }

    const prepared = this.prepared;
    if (prepared?.sessionId === sessionId && prepared.client.connected) {
      let completion: Promise<void>;
      try {
        prepared.client.prepareAudio?.();
        completion = Promise.resolve(prepared.client.startCall()).then(
          () => {
            if (!this.isCurrent(prepared)) this.stopClient(prepared.client);
          },
          (error) => {
            if (!this.isCurrent(prepared)) this.stopClient(prepared.client);
            throw error;
          },
        );
      } catch (error) {
        completion = Promise.reject(error);
      }
      return { kind: "started", client: prepared.client, completion };
    }

    const reason: VoicePreparationReason = !prepared
      ? "missing-client"
      : prepared.sessionId !== sessionId
        ? "wrong-session"
        : "disconnected-client";
    this.clear();
    const client = this.prepare(sessionId, createClient);
    return { kind: "preparing", reason, client };
  }

  acceptsEvent(sessionId: string, client: Client, currentSessionId: string | null): boolean {
    const prepared = this.prepared;
    return currentSessionId === sessionId && prepared?.sessionId === sessionId && prepared.client === client && prepared.generation === this.generation;
  }

  clear(): void {
    const prepared = this.prepared;
    this.generation += 1;
    this.prepared = null;
    if (prepared) this.stopClient(prepared.client);
  }

  private isCurrent(prepared: PreparedVoiceClient<Client>): boolean {
    return this.prepared === prepared && prepared.generation === this.generation;
  }

  private stopClient(client: Client): void {
    try { client.disconnect(); } catch {}
  }
}
